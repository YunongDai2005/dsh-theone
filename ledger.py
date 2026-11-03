"""Deterministic support workflow. All actions are internal records and drafts."""
import csv
import hashlib
import io
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat()


def parse_csv(value, fields):
    if not isinstance(value, str) or len(value.encode()) > 150_000:
        raise Problem("CSV must be text under 150 KB.")
    reader = csv.DictReader(io.StringIO(value.lstrip('\ufeff')))
    if reader.fieldnames != fields:
        raise Problem("Expected CSV columns: " + ",".join(fields))
    rows = []
    seen = set()
    for row in reader:
        if len(rows) >= 100:
            raise Problem("Use at most 100 rows per CSV.")
        if None in row or any(v is None or not v.strip() or len(v) > 500 for v in row.values()):
            raise Problem("Each row needs all columns, with 1–500 characters per field.")
        row = {k: v.strip() for k, v in row.items()}
        key = row[fields[0]]
        if key in seen:
            raise Problem("Duplicate identifier: " + key)
        seen.add(key)
        rows.append(row)
    if not rows:
        raise Problem("CSV needs at least one data row.")
    return rows


def diagnose(ticket, shipment):
    """Rules v1: deterministic branches, no model, no inferred carrier data."""
    if shipment is None:
        return dict(rule="MISSING_ORDER", priority="high", action="Investigate order", reason="No matching order in the supplied shipment snapshot.", draft=f"Hello {ticket['customer']}, we need to verify order {ticket['order_id']} before providing a delivery update.")
    status = shipment["status"]
    days = shipment["days_idle"]
    if ticket["issue"].lower() == "damaged":
        return dict(rule="DAMAGE_REVIEW", priority="high", action="Review damage report", reason="Customer reports damage. Evidence and a human decision are required; no replacement or refund is promised.", draft=f"Hello {ticket['customer']}, we have prepared an internal review for the damage reported on order {ticket['order_id']}. Please keep the packaging and provide photographs.")
    if status == "delivered":
        return dict(rule="DELIVERY_DISPUTE", priority="high", action="Verify delivery", reason="Snapshot says delivered while a support ticket remains open. Verify delivery evidence before resolving.", draft=f"Hello {ticket['customer']}, the supplied record marks order {ticket['order_id']} as delivered. We need to check its delivery evidence with you.")
    if status == "exception" or days >= 3:
        return dict(rule="CARRIER_FOLLOWUP", priority="medium", action="Prepare carrier follow-up", reason=f"Shipment status is {status}; {days} idle days in the supplied snapshot. Follow-up threshold is 3 days.", draft=f"Hello {ticket['customer']}, order {ticket['order_id']} needs a delivery investigation. An internal follow-up has been prepared for {shipment['carrier']}; no response has been received yet.")
    return dict(rule="TRACKING_UPDATE", priority="low", action="Prepare tracking update", reason=f"Status {status}, {days} idle days: below the 3-day follow-up threshold.", draft=f"Hello {ticket['customer']}, your order {ticket['order_id']} is marked {status} in the supplied snapshot. Carrier: {shipment['carrier']}. Tracking reference: {shipment['tracking']}.")


class Ledger:
    def __init__(self, path):
        self.path = str(path)
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, created TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS artifacts(run_id TEXT NOT NULL, ticket_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,ticket_id));
            CREATE INDEX IF NOT EXISTS owner_runs ON runs(owner,created);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _get(self, db, owner, run_id):
        row = db.execute("SELECT * FROM runs WHERE id=? AND owner=?", (run_id, owner)).fetchone()
        if not row:
            raise Problem("Workflow not found in this workspace.", 404)
        data = json.loads(row["data"])
        return {**dict(row), "data": data}

    def get(self, owner, run_id):
        with self.db() as db:
            run = self._get(db, owner, run_id)
            run["artifacts"] = [json.loads(x[0]) for x in db.execute("SELECT body FROM artifacts WHERE run_id=? ORDER BY ticket_id", (run_id,))]
            del run["owner"]
            return run

    def list(self, owner):
        with self.db() as db:
            return [dict(x) for x in db.execute("SELECT id,created,state,revision FROM runs WHERE owner=? ORDER BY created DESC", (owner,))]

    def _save(self, db, run, event, detail):
        run["data"]["events"].append({"at": now(), "event": event, "detail": detail})
        db.execute("UPDATE runs SET state=?, revision=?, data=? WHERE id=?", (run["state"], run["revision"], json.dumps(run["data"]), run["id"]))

    def create(self, owner, tickets_csv, shipments_csv):
        tickets = parse_csv(tickets_csv, ["ticket_id", "customer", "order_id", "issue"])
        shipments = parse_csv(shipments_csv, ["order_id", "status", "days_idle", "carrier", "tracking"])
        for row in shipments:
            if row["status"] not in {"in_transit", "delivered", "exception", "pending"}:
                raise Problem("Shipment status must be in_transit, delivered, exception or pending.")
            try:
                days = int(row["days_idle"])
            except ValueError:
                raise Problem("days_idle must be a whole number.")
            if not 0 <= days <= 365:
                raise Problem("days_idle must be between 0 and 365.")
            row["days_idle"] = days
        stamp, run_id = now(), uuid.uuid4().hex
        digest = hashlib.sha256(json.dumps({"tickets": tickets, "shipments": shipments}, sort_keys=True).encode()).hexdigest()
        data = {"tickets": tickets, "shipments": shipments, "source_sha256": digest, "rules_version": "1", "cases": [], "events": [{"at": stamp, "event": "imported", "detail": f"Validated {len(tickets)} tickets and {len(shipments)} shipments."}]}
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT count(*) FROM runs WHERE owner=?", (owner,)).fetchone()[0] >= 25 or db.execute("SELECT count(*) FROM runs").fetchone()[0] >= 2000:
                raise Problem("Demo workspace capacity reached.", 429)
            db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?)", (run_id, owner, stamp, "imported", 0, json.dumps(data)))
        return self.get(owner, run_id)

    def analyze(self, owner, run_id, revision):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            run = self._get(db, owner, run_id)
            self._revision(run, revision)
            if run["state"] == "completed":
                raise Problem("Completed evidence is immutable. Import a new snapshot.", 409)
            shipments = {x["order_id"]: x for x in run["data"]["shipments"]}
            run["data"]["cases"] = [{**t, "shipment": shipments.get(t["order_id"]), **diagnose(t, shipments.get(t["order_id"])), "decision": None, "note": ""} for t in run["data"]["tickets"]]
            run["revision"] += 1
            run["state"] = "analyzed"
            self._save(db, run, "analyzed", f"Rules v1 evaluated {len(run['data']['cases'])} tickets. Prior decisions cleared; revision {run['revision']}.")
        return self.get(owner, run_id)

    def _revision(self, run, revision):
        if type(revision) is not int or revision != run["revision"]:
            raise Problem("This review is stale. Reload the workflow before continuing.", 409)

    def review(self, owner, run_id, revision, ticket_id, decision, note):
        if decision not in {"approve", "hold"} or not isinstance(note, str) or len(note.strip()) < 3 or len(note) > 500:
            raise Problem("Choose approve or hold and add a 3–500 character review note.")
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            run = self._get(db, owner, run_id)
            self._revision(run, revision)
            if run["state"] not in {"analyzed", "reviewed"}:
                raise Problem("Analyze this workflow before reviewing; completed runs cannot change.", 409)
            case = next((x for x in run["data"]["cases"] if x["ticket_id"] == ticket_id), None)
            if not case:
                raise Problem("Ticket not found.", 404)
            case.update(decision=decision, note=note.strip())
            run["revision"] += 1
            run["state"] = "reviewed" if all(x["decision"] for x in run["data"]["cases"]) else "analyzed"
            self._save(db, run, "reviewed", f"{ticket_id}: {decision}. Note: {note.strip()}")
        return self.get(owner, run_id)

    def execute(self, owner, run_id, revision, after_write=None):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            run = self._get(db, owner, run_id)
            # Replay is safe even if a client retries an old completed request.
            if run["state"] != "completed":
                self._revision(run, revision)
                if run["state"] != "reviewed":
                    raise Problem("Review every ticket before creating the handoff.", 409)
                stamp = now()
                for case in run["data"]["cases"]:
                    if case["decision"] != "approve":
                        continue
                    artifact = {"record_id": f"{run_id}:{case['ticket_id']}", "ticket_id": case["ticket_id"], "order_id": case["order_id"], "action": case["action"], "priority": case["priority"], "rule": case["rule"], "draft": case["draft"], "review_note": case["note"], "created_at": stamp, "source_sha256": run["data"]["source_sha256"], "delivery_status": "internal_record_only_not_sent"}
                    db.execute("INSERT INTO artifacts VALUES(?,?,?)", (run_id, case["ticket_id"], json.dumps(artifact)))
                    if after_write:
                        after_write()
                run["state"] = "completed"
                run["revision"] += 1
                self._save(db, run, "executed", "Internal handoff records and reply drafts committed atomically. Held tickets preserved; nothing sent externally.")
        return self.get(owner, run_id)

    def export(self, owner, run_id):
        run = self.get(owner, run_id)
        if run["state"] != "completed":
            raise Problem("Complete the workflow to export its evidence.", 409)
        return {"format": "dispatch-ledger/v1", "scope": "Internal support records and unsent drafts; input provenance is user supplied, demo fixtures are synthetic.", "workflow": run}


def export_csv(bundle):
    out = io.StringIO()
    keys = ["ticket_id", "order_id", "action", "priority", "rule", "draft", "review_note", "delivery_status"]
    writer = csv.DictWriter(out, fieldnames=keys)
    writer.writeheader()
    for item in bundle["workflow"]["artifacts"]:
        row = {k: str(item[k]) for k in keys}
        for k, value in row.items():
            if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                row[k] = "'" + value
        writer.writerow(row)
    return out.getvalue()
