// Le runbook d'incident joué de bout en bout à chaque vérification :
// sessions, jeton du Hub, clé maîtresse, jeton d'un service, secrets, mot de
// passe, sauvegarde et restauration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('exercice du runbook d\'incident : chaque geste par son vrai chemin, son effet vérifié', () => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'outils', 'exercice-incident.mjs')], { encoding: 'utf8', timeout: 180_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /vérifications réussies/);
});
