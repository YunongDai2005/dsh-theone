// Only these server-authored parameterized queries are executed. Models never supply Cypher.
export const Q = {
  init: `MERGE (:Workspace {id: 'workspace'}) RETURN 1 AS ready`,
  topics: `MATCH (t:Topic) RETURN t.id AS id, t.title AS title ORDER BY t.title`,
  topic: `MATCH (t:Topic {id: $id}) RETURN t.id AS id, t.title AS title`,
  createTopic: `CREATE (t:Topic {id: $id, title: $title}) RETURN t.id AS id, t.title AS title`,
  owned: `MATCH (f:Fact {ownerId: $topic, key: $key}) RETURN f.id AS id, f.revision AS revision`,
  createFact: `MATCH (t:Topic {id: $topic})
    MERGE (f:Fact {ownerId: $topic, key: $key})
    ON CREATE SET f.id = $id, f.revision = 1
    WITH t, f WHERE f.id = $id
    CREATE (a:Assertion {id: $assertion, revision: 1, value: $value, at: $at}),
      (e:Evidence {id: $evidenceId, text: $evidence, kind: 'user-confirmed synthetic input'}),
      (t)-[:USES {grant: 'owner'}]->(f), (f)-[:CURRENT]->(a), (a)-[:SUPPORTED_BY]->(e)
    RETURN f.id AS id, f.revision AS revision`,
  revise: `MATCH (t:Topic {id: $topic})-[:USES {grant: 'owner'}]->(f:Fact {id: $id})-[c:CURRENT]->(old:Assertion)
    WHERE f.ownerId = $topic AND f.revision = $expected
    CREATE (a:Assertion {id: $assertion, revision: $next, value: $value, at: $at}),
      (e:Evidence {id: $evidenceId, text: $evidence, kind: 'user-confirmed synthetic input'}),
      (a)-[:SUPPORTED_BY]->(e), (a)-[:SUPERSEDES]->(old), (f)-[:CURRENT]->(a)
    SET f.revision = $next DELETE c RETURN f.id AS id, f.revision AS revision`,
  share: `MATCH (owner:Topic {id: $owner})-[:USES {grant: 'owner'}]->(f:Fact {id: $id}), (target:Topic {id: $target})
    WHERE f.ownerId = $owner AND target.id <> owner.id
    MERGE (target)-[r:USES]->(f) SET r.grant = 'explicit user confirmation'
    RETURN target.id AS id`,
  revoke: `MATCH (:Topic {id: $target})-[r:USES]->(f:Fact {id: $id})
    WHERE f.ownerId = $owner AND $target <> $owner DELETE r RETURN f.id AS id`,
  context: `MATCH (t:Topic {id: $topic})-[u:USES]->(f:Fact)-[:CURRENT]->(a:Assertion)-[:SUPPORTED_BY]->(e:Evidence)
    RETURN f.id AS id, f.key AS key, f.ownerId AS ownerId, a.value AS value, a.revision AS revision,
      e.text AS evidence, u.grant AS grant, t.title AS topic ORDER BY f.key`,
  impact: `MATCH (t:Topic)-[u:USES]->(f:Fact {id: $id})-[:CURRENT]->(a:Assertion)
    RETURN t.id AS id, t.title AS title, u.grant AS grant, f.key AS key, a.value AS value, a.revision AS revision ORDER BY t.title`,
  history: `MATCH (f:Fact {id: $id})-[:CURRENT]->(a:Assertion)-[:SUPERSEDES*0..50]->(old:Assertion)-[:SUPPORTED_BY]->(e:Evidence)
    RETURN old.revision AS revision, old.value AS value, e.text AS evidence, old.at AS at ORDER BY old.revision DESC`,
};
