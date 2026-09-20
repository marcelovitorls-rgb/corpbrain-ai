const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const database = require('../server/database');
const { JWT_SECRET } = require('../server/config');
const { encryptSecret, decryptSecret, isCurrentEncryption } = require('../server/lib/secrets');

test('AI secret encryption is independent and round-trips', () => {
  const original = 'secret-value-for-test';
  const encrypted = encryptSecret(original);

  assert.notEqual(encrypted, original);
  assert.equal(isCurrentEncryption(encrypted), true);
  assert.equal(decryptSecret(encrypted), original);
});

test('temporary-password users are blocked by backend middleware', async () => {
  const originalGetDb = database.getDb;
  database.getDb = () => ({
    prepare: () => ({
      get: () => ({ id: 7, email: 'temporary@example.com', role: 'user', name: 'Temporary', must_change_password: 1 })
    })
  });

  const { authMiddleware } = require('../server/middleware/auth');
  const app = express();
  app.use('/protected', authMiddleware, (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const token = jwt.sign({ id: 7 }, JWT_SECRET);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/protected`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    assert.equal(response.status, 428);
    assert.equal(body.code, 'PASSWORD_CHANGE_REQUIRED');
  } finally {
    database.getDb = originalGetDb;
    await new Promise(resolve => server.close(resolve));
  }
});

after(() => {
  database.getDb = require('../server/database').getDb;
});
