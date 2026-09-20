const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../server/config');

test('self-service profile validates fields and cannot change account or permissions', async () => {
    // In-memory database double keeps these tests away from the project database.
    const users = new Map([
        [1, { id: 1, name: 'Admin', title: '', initials: 'A', email: 'admin@example.com', role: 'admin' }],
        [2, { id: 2, name: 'Pessoa', title: '', initials: 'P', email: 'user@example.com', role: 'user' }]
    ]);
    const database = require('../server/database');
    const original = database.getDb;
    database.getDb = () => ({ prepare: sql => ({
        get: id => users.get(Number(id)),
        run: (name, title, initials, id) => {
            assert.equal(sql, 'UPDATE users SET name = ?, title = ?, initials = ? WHERE id = ?');
            Object.assign(users.get(id), { name, title, initials });
        }
    }) });
    const app = express();
    app.use(express.json());
    app.use('/auth', require('../server/routes/auth'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/auth/me`;
    const token = jwt.sign({ id: 2 }, JWT_SECRET);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    try {
        assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
        for (const body of [{ name: ' ', title: '', initials: '' }, { name: {}, title: '', initials: '' }, { name: 'A', title: 'x'.repeat(101), initials: '' }, { name: 'A', title: '', initials: 'ABCD' }]) {
            assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) })).status, 400);
        }
        const response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ name: ' Demo User ', title: ' Design ', initials: '', id: 1, role: 'admin', email: 'changed@example.com', password: 'changed' }) });
        assert.equal(response.status, 200);
        const { user } = await response.json();
        assert.equal(user.name, 'Demo User');
        assert.equal(user.title, 'Design');
        assert.equal(user.initials, 'DU');
        assert.equal(user.role, 'user');
        assert.equal(user.email, 'user@example.com');
        assert.equal(user.password, undefined);
        assert.equal(users.get(1).name, 'Admin');
        assert.equal((await (await fetch(url, { headers })).json()).user.name, 'Demo User');
    } finally {
        database.getDb = original;
        await new Promise(resolve => server.close(resolve));
    }
});
