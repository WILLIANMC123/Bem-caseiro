const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));

const ADMIN_USUARIO = 'Willian';
const ADMIN_SENHA = 'paesedelicias';
const SECRET = 'bem-caseiro-secret-2026';

const ADMIN_TOKEN = crypto
    .createHash('sha256')
    .update(ADMIN_USUARIO + ':' + ADMIN_SENHA + ':' + SECRET)
    .digest('hex');

function tokenCliente(id, cpf) {
    return crypto
        .createHash('sha256')
        .update('cliente:' + id + ':' + cpf + ':' + SECRET)
        .digest('hex');
}

const db = new sqlite3.Database('./siscristovao.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        cpf TEXT NOT NULL UNIQUE,
        telefone TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS servicos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        descricao TEXT NOT NULL,
        preco REAL NOT NULL,
        tempo_estimado INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        data TEXT NOT NULL,
        responsavel TEXT NOT NULL,
        total REAL NOT NULL,
        tempo_total INTEGER NOT NULL,
        FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS itens_agendamento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agendamento_id INTEGER NOT NULL,
        servico_id INTEGER NOT NULL,
        preco_cobrado REAL NOT NULL,
        FOREIGN KEY (agendamento_id) REFERENCES agendamentos (id),
        FOREIGN KEY (servico_id) REFERENCES servicos (id)
    )`);
});

function extrairToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return null;
}

function exigirAdmin(req, res, next) {
    if (extrairToken(req) === ADMIN_TOKEN) return next();
    return res.status(401).json({ error: 'Acesso restrito ao administrador.' });
}

function exigirLogado(req, res, next) {
    const token = extrairToken(req);
    if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (token === ADMIN_TOKEN) {
        req.user = { tipo: 'admin', nome: ADMIN_USUARIO };
        return next();
    }
    db.all('SELECT id, nome, cpf, telefone FROM clientes', [], (err2, clientes) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const cliente = (clientes || []).find(c => tokenCliente(c.id, c.cpf) === token);
        if (!cliente) return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
        req.user = { tipo: 'cliente', id: cliente.id, nome: cliente.nome, cpf: cliente.cpf };
        next();
    });
}
