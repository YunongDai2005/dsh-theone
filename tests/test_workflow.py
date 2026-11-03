import concurrent.futures
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from ledger import Ledger, Problem, export_csv
from server import make_server

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
TICKETS = (FIXTURES / "tickets.csv").read_text()
SHIPMENTS = (FIXTURES / "shipments.csv").read_text()


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "test.sqlite3"
        self.store = Ledger(self.path)
        self.run = self.store.create("one", TICKETS, SHIPMENTS)

    def tearDown(self):
        self.tmp.cleanup()

    def analyzed(self):
        self.run = self.store.analyze("one", self.run["id"], self.run["revision"])
        return self.run

    def reviewed(self):
        self.analyzed()
        for case in self.run["data"]["cases"]:
            self.run = self.store.review("one", self.run["id"], self.run["revision"], case["ticket_id"], "hold" if case["rule"] == "MISSING_ORDER" else "approve", "Checked the supplied synthetic evidence.")
        return self.run

    def test_expected_five_policy_branches(self):
        cases = self.analyzed()["data"]["cases"]
        self.assertEqual([c["rule"] for c in cases], ["TRACKING_UPDATE", "CARRIER_FOLLOWUP", "DELIVERY_DISPUTE", "DAMAGE_REVIEW", "MISSING_ORDER"])

    def test_threshold_boundary_and_no_inferred_carrier_fact(self):
        ship = SHIPMENTS.replace("in_transit,1", "in_transit,3")
        run = self.store.create("one", TICKETS, ship)
        run = self.store.analyze("one", run["id"], 0)
        self.assertEqual(run["data"]["cases"][0]["rule"], "CARRIER_FOLLOWUP")
        self.assertIn("no response has been received", run["data"]["cases"][0]["draft"])

    def test_reject_duplicate_ids_bad_days_and_row_limit(self):
        for tickets, shipments in [(TICKETS + TICKETS.splitlines()[1] + "\n", SHIPMENTS), (TICKETS, SHIPMENTS.replace("in_transit,1", "in_transit,-1")), ("ticket_id,customer,order_id,issue\n" + "\n".join(f"{i},A,O,X" for i in range(101)), SHIPMENTS)]:
            with self.assertRaises(Problem):
                self.store.create("one", tickets, shipments)

    def test_cannot_execute_before_every_decision(self):
        self.analyzed()
        with self.assertRaises(Problem) as cm:
            self.store.execute("one", self.run["id"], self.run["revision"])
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(self.store.get("one", self.run["id"])["artifacts"], [])

    def test_stale_review_rejected_and_reanalysis_clears_decisions(self):
        self.analyzed()
        old_revision = self.run["revision"]
        run = self.store.review("one", self.run["id"], old_revision, "T-1041", "approve", "Reviewed evidence")
        with self.assertRaises(Problem) as cm:
            self.store.review("one", run["id"], old_revision, "T-1042", "approve", "Other tab")
        self.assertEqual(cm.exception.status, 409)
        run = self.store.analyze("one", run["id"], run["revision"])
        self.assertTrue(all(x["decision"] is None for x in run["data"]["cases"]))

    def test_unauthorized_workspace_cannot_read_or_write(self):
        for method, args in [(self.store.get, []), (self.store.analyze, [0]), (self.store.export, [])]:
            with self.assertRaises(Problem) as cm:
                method("other", self.run["id"], *args)
            self.assertEqual(cm.exception.status, 404)

    def test_transaction_rolls_back_after_actual_first_insert(self):
        self.reviewed()
        writes = []
        def fail():
            writes.append(True)
            raise RuntimeError("injected failure after first SQL insert")
        with self.assertRaises(RuntimeError):
            self.store.execute("one", self.run["id"], self.run["revision"], after_write=fail)
        self.assertEqual(len(writes), 1)
        reopened = Ledger(self.path).get("one", self.run["id"])
        self.assertEqual(reopened["state"], "reviewed")
        self.assertEqual(reopened["artifacts"], [])
        done = self.store.execute("one", self.run["id"], self.run["revision"])
        self.assertEqual(len(done["artifacts"]), 4)

    def test_concurrent_replay_commits_only_once(self):
        self.reviewed()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.store.execute("one", self.run["id"], self.run["revision"]), range(4)))
        self.assertTrue(all(len(r["artifacts"]) == 4 for r in results))
        self.assertEqual(sum(x["event"] == "executed" for x in results[0]["data"]["events"]), 1)

    def test_completed_immutable_and_export_carries_review_and_source(self):
        self.reviewed()
        done = self.store.execute("one", self.run["id"], self.run["revision"])
        with self.assertRaises(Problem):
            self.store.analyze("one", done["id"], done["revision"])
        bundle = self.store.export("one", done["id"])
        self.assertEqual(len(bundle["workflow"]["data"]["cases"]), 5)
        self.assertTrue(all(a["source_sha256"] == self.run["data"]["source_sha256"] for a in done["artifacts"]))
        self.assertTrue(all(a["delivery_status"] == "internal_record_only_not_sent" for a in done["artifacts"]))

    def test_csv_export_defends_formula_cells(self):
        self.reviewed()
        self.run = self.store.review("one", self.run["id"], self.run["revision"], "T-1041", "approve", '=HYPERLINK("https://example.invalid")')
        self.store.execute("one", self.run["id"], self.run["revision"])
        self.assertIn("'=HYPERLINK", export_csv(self.store.export("one", self.run["id"])))


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.start()
        _, _, headers = self.request("GET", "/api/runs")
        self.cookie = headers["Set-Cookie"].split(";")[0]

    def start(self):
        self.server = make_server(port=0, data_dir=self.tmp.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.authority = "127.0.0.1:" + str(self.server.server_port)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def tearDown(self):
        self.stop()
        self.tmp.cleanup()

    def request(self, method, path, body=None, origin=None, cookie=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {"Origin": origin or "http://" + self.authority, "Content-Type": "application/json"}
        if host:
            headers["Host"] = host
        if cookie or hasattr(self, "cookie"):
            headers["Cookie"] = cookie or self.cookie
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        res = conn.getresponse()
        status, info, payload = res.status, dict(res.getheaders()), res.read()
        conn.close()
        return status, json.loads(payload), info

    def test_cross_origin_and_bad_host_denied(self):
        status, _, _ = self.request("POST", "/api/runs", {}, origin="https://outside.invalid")
        self.assertEqual(status, 403)
        status, _, _ = self.request("GET", "/api/runs", host="outside.invalid")
        self.assertEqual(status, 403)

    def test_cookie_forgery_has_no_access_to_run(self):
        _, run, _ = self.request("POST", "/api/runs", {"tickets_csv": TICKETS, "shipments_csv": SHIPMENTS})
        status, _, _ = self.request("GET", "/api/runs/" + run["id"], cookie="ledger_workspace=" + "a" * 48 + ".fake")
        self.assertEqual(status, 404)

    def test_real_http_restart_retains_workspace(self):
        _, run, _ = self.request("POST", "/api/runs", {"tickets_csv": TICKETS, "shipments_csv": SHIPMENTS})
        self.stop()
        self.start()
        status, reopened, _ = self.request("GET", "/api/runs/" + run["id"])
        self.assertEqual(status, 200)
        self.assertEqual(reopened["data"]["source_sha256"], run["data"]["source_sha256"])


if __name__ == "__main__":
    unittest.main()
