const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));

const LOGIN_USUARIO = 'Willian';
const LOGIN_SENHA = 'paesedelicias';
const AUTH_TOKEN = crypto
    .createHash('sha256')
    .update(LOGIN_USUARIO + ':' + LOGIN_SENHA + ':bem-caseiro')
    .digest('hex');

const db = new sqlite3.Database('./siscristovao.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        cpf TEXT NOT NULL,
        telefone TEXT NOT NULL
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
    if (req.query && req.query.token) return String(req.query.token);
    return null;
}

function exigirAuth(req, res, next) {
    const token = extrairToken(req);
    if (token && token === AUTH_TOKEN) return next();
    return res.status(401).json({ error: 'Não autorizado. Faça login para ver os pedidos.' });
}

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body || {};
    if (
        typeof usuario === 'string' &&
        typeof senha === 'string' &&
        usuario.trim() === LOGIN_USUARIO &&
        senha === LOGIN_SENHA
    ) {
        return res.json({ success: true, token: AUTH_TOKEN });
    }
    return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos.' });
});

app.get('/verificar-auth', (req, res) => {
    const token = extrairToken(req);
    if (token && token === AUTH_TOKEN) {
        return res.json({ autenticado: true });
    }
    return res.json({ autenticado: false });
});

app.post('/salvar-cliente', (req, res) => {
    const { nome, cpf, telefone } = req.body;
    if (!nome || !cpf || !telefone) {
        return res.status(400).send('Preencha todos os campos obrigatórios.');
    }
    const sql = `INSERT INTO clientes (nome, cpf, telefone) VALUES (?, ?, ?)`;
    db.run(sql, [nome.trim(), cpf.trim(), telefone.trim()], (err) => {
        if (err) return res.status(500).send('Erro ao salvar cliente: ' + err.message);
        res.redirect('/clientes.html');
    });
});

app.get('/listar-clientes', (req, res) => {
    const sql = `SELECT * FROM clientes ORDER BY nome ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/salvar-servico', (req, res) => {
    const { descricao, preco, tempo_estimado } = req.body;
    if (!descricao || preco === undefined || tempo_estimado === undefined) {
        return res.status(400).send('Preencha todos os campos obrigatórios.');
    }
    const precoNum = parseFloat(preco);
    const tempoNum = parseInt(tempo_estimado, 10);
    if (isNaN(precoNum) || precoNum < 0 || isNaN(tempoNum) || tempoNum < 0) {
        return res.status(400).send('Preço e tempo devem ser números válidos.');
    }
    const sql = `INSERT INTO servicos (descricao, preco, tempo_estimado) VALUES (?, ?, ?)`;
    db.run(sql, [descricao.trim(), precoNum, tempoNum], (err) => {
        if (err) return res.status(500).send('Erro ao salvar serviço: ' + err.message);
        res.redirect('/servicos.html');
    });
});

app.get('/listar-servicos', (req, res) => {
    const sql = `SELECT * FROM servicos ORDER BY descricao ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/finalizar-agendamento', (req, res) => {
    const { cliente_id, data, responsavel, total, tempo_total, servicos } = req.body;
    if (!cliente_id || !data || !responsavel || !Array.isArray(servicos) || servicos.length === 0) {
        return res.status(400).json({ success: false, error: 'Dados incompletos. Selecione cliente, data, responsável e ao menos um serviço.' });
    }
    const totalNum = parseFloat(total);
    const tempoNum = parseInt(tempo_total, 10);
    if (isNaN(totalNum) || isNaN(tempoNum)) {
        return res.status(400).json({ success: false, error: 'Total ou tempo inválidos.' });
    }
    const sqlMestre = `INSERT INTO agendamentos (cliente_id, data, responsavel, total, tempo_total) VALUES (?, ?, ?, ?, ?)`;
    db.run(sqlMestre, [cliente_id, data, responsavel.trim(), totalNum, tempoNum], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const agendamentoId = this.lastID;
        const sqlDetalhe = `INSERT INTO itens_agendamento (agendamento_id, servico_id, preco_cobrado) VALUES (?, ?, ?)`;
        const stmt = db.prepare(sqlDetalhe);
        let erroDetalhe = null;
        servicos.forEach((item) => {
            if (erroDetalhe) return;
            stmt.run(agendamentoId, item.id, item.preco, (errRun) => {
                if (errRun) erroDetalhe = errRun;
            });
        });
        stmt.finalize((errFinalize) => {
            if (erroDetalhe || errFinalize) {
                return res.status(500).json({ success: false, error: (erroDetalhe || errFinalize).message });
            }
            res.json({ success: true, id: agendamentoId });
        });
    });
});

app.get('/listar-agendamentos', exigirAuth, (req, res) => {
    const sql = `
        SELECT a.id, a.data, a.responsavel, a.total, a.tempo_total, c.nome as nome_cliente
        FROM agendamentos a
        INNER JOIN clientes c ON a.cliente_id = c.id
        ORDER BY a.id DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/detalhes-agendamento/:id', exigirAuth, (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT i.preco_cobrado, s.descricao, s.tempo_estimado
        FROM itens_agendamento i
        INNER JOIN servicos s ON i.servico_id = s.id
        WHERE i.agendamento_id = ?`;
    db.all(sql, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('====================================================');
    console.log('🚀 Bem Caseiro rodando com sucesso na porta ' + PORT);
    console.log('📂 Banco de Dados: siscristovao.db');
    console.log('🔒 Consulta de pedidos protegida por login');
    console.log('====================================================');
});
