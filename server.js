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
        entregue INTEGER DEFAULT 0,
        FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS itens_agendamento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agendamento_id INTEGER NOT NULL,
        servico_id INTEGER NOT NULL,
        preco_cobrado REAL NOT NULL,
        quantidade INTEGER DEFAULT 1,
        FOREIGN KEY (agendamento_id) REFERENCES agendamentos (id),
        FOREIGN KEY (servico_id) REFERENCES servicos (id)
    )`);

    // Migrações para bancos já existentes
    db.run(`ALTER TABLE agendamentos ADD COLUMN entregue INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE itens_agendamento ADD COLUMN quantidade INTEGER DEFAULT 1`, () => {});
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

app.post('/cadastrar', (req, res) => {
    const { nome, cpf, telefone } = req.body || {};
    if (!nome || !cpf) {
        return res.status(400).json({ success: false, error: 'Informe nome e CPF.' });
    }
    const nomeT = String(nome).trim();
    const cpfT = String(cpf).trim().replace(/\D/g, '') || String(cpf).trim();
    const telT = telefone ? String(telefone).trim() : '';

    if (nomeT.toLowerCase() === ADMIN_USUARIO.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'Este nome de usuário é reservado.' });
    }

    db.run(
        `INSERT INTO clientes (nome, cpf, telefone) VALUES (?, ?, ?)`,
        [nomeT, cpfT, telT],
        function (err) {
            if (err) {
                if (String(err.message).includes('UNIQUE')) {
                    return res.status(400).json({ success: false, error: 'Já existe um cliente com este CPF. Faça login.' });
                }
                return res.status(500).json({ success: false, error: err.message });
            }
            const id = this.lastID;
            const token = tokenCliente(id, cpfT);
            res.json({
                success: true,
                tipo: 'cliente',
                token,
                usuario: { id, nome: nomeT, cpf: cpfT, telefone: telT }
            });
        }
    );
});

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) {
        return res.status(400).json({ success: false, error: 'Informe usuário e senha.' });
    }
    const u = String(usuario).trim();
    const s = String(senha).trim();

    if (u === ADMIN_USUARIO && s === ADMIN_SENHA) {
        return res.json({
            success: true,
            tipo: 'admin',
            token: ADMIN_TOKEN,
            usuario: { nome: ADMIN_USUARIO }
        });
    }

    const cpfNorm = s.replace(/\D/g, '') || s;
    db.all(`SELECT id, nome, cpf, telefone FROM clientes`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const cliente = (rows || []).find(c => {
            const cpfDb = String(c.cpf).replace(/\D/g, '') || c.cpf;
            return c.nome.toLowerCase() === u.toLowerCase() && (c.cpf === s || cpfDb === cpfNorm);
        });
        if (!cliente) {
            return res.status(401).json({ success: false, error: 'Nome ou CPF incorretos.' });
        }
        const token = tokenCliente(cliente.id, cliente.cpf);
        res.json({
            success: true,
            tipo: 'cliente',
            token,
            usuario: {
                id: cliente.id,
                nome: cliente.nome,
                cpf: cliente.cpf,
                telefone: cliente.telefone
            }
        });
    });
});

app.get('/verificar-auth', (req, res) => {
    const token = extrairToken(req);
    if (!token) return res.json({ autenticado: false });
    if (token === ADMIN_TOKEN) {
        return res.json({ autenticado: true, tipo: 'admin', usuario: { nome: ADMIN_USUARIO } });
    }
    db.all('SELECT id, nome, cpf, telefone FROM clientes', [], (err, clientes) => {
        if (err) return res.json({ autenticado: false });
        const cliente = (clientes || []).find(c => tokenCliente(c.id, c.cpf) === token);
        if (!cliente) return res.json({ autenticado: false });
        res.json({
            autenticado: true,
            tipo: 'cliente',
            usuario: { id: cliente.id, nome: cliente.nome, cpf: cliente.cpf, telefone: cliente.telefone }
        });
    });
});

app.post('/salvar-cliente', exigirAdmin, (req, res) => {
    const { nome, cpf, telefone } = req.body;
    if (!nome || !cpf) {
        return res.status(400).json({ error: 'Preencha nome e CPF.' });
    }
    const cpfT = String(cpf).trim().replace(/\D/g, '') || String(cpf).trim();
    db.run(
        `INSERT INTO clientes (nome, cpf, telefone) VALUES (?, ?, ?)`,
        [nome.trim(), cpfT, (telefone || '').trim()],
        function (err) {
            if (err) {
                if (String(err.message).includes('UNIQUE')) {
                    return res.status(400).json({ error: 'CPF já cadastrado.' });
                }
                return res.status(500).json({ error: err.message });
            }
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.json({ success: true, id: this.lastID });
            }
            res.redirect('/clientes.html');
        }
    );
});

app.get('/listar-clientes', exigirAdmin, (req, res) => {
    db.all(`SELECT * FROM clientes ORDER BY nome ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/atualizar-cliente', exigirAdmin, (req, res) => {
    const { id, nome, cpf, telefone } = req.body || {};
    if (!id || !nome || !cpf) {
        return res.status(400).json({ error: 'Informe id, nome e CPF.' });
    }
    const cpfT = String(cpf).trim().replace(/\D/g, '') || String(cpf).trim();
    const nomeT = String(nome).trim();
    if (nomeT.toLowerCase() === ADMIN_USUARIO.toLowerCase()) {
        return res.status(400).json({ error: 'Este nome de usuário é reservado.' });
    }
    db.run(
        `UPDATE clientes SET nome = ?, cpf = ?, telefone = ? WHERE id = ?`,
        [nomeT, cpfT, (telefone || '').trim(), id],
        function (err) {
            if (err) {
                if (String(err.message).includes('UNIQUE')) {
                    return res.status(400).json({ error: 'CPF já cadastrado em outro cliente.' });
                }
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado.' });
            }
            res.json({ success: true });
        }
    );
});

app.post('/excluir-cliente', exigirAdmin, (req, res) => {
    const id = req.body && req.body.id;
    if (!id) {
        return res.status(400).json({ error: 'Informe o id do cliente.' });
    }
    db.all(`SELECT id FROM agendamentos WHERE cliente_id = ?`, [id], (err, ags) => {
        if (err) return res.status(500).json({ error: err.message });
        const ids = (ags || []).map(a => a.id);

        function apagarCliente() {
            db.run(`DELETE FROM clientes WHERE id = ?`, [id], function (errDel) {
                if (errDel) return res.status(500).json({ error: errDel.message });
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Cliente não encontrado.' });
                }
                res.json({ success: true });
            });
        }

        if (!ids.length) {
            return apagarCliente();
        }

        const placeholders = ids.map(() => '?').join(',');
        db.run(
            `DELETE FROM itens_agendamento WHERE agendamento_id IN (${placeholders})`,
            ids,
            (errItens) => {
                if (errItens) return res.status(500).json({ error: errItens.message });
                db.run(
                    `DELETE FROM agendamentos WHERE cliente_id = ?`,
                    [id],
                    (errAg) => {
                        if (errAg) return res.status(500).json({ error: errAg.message });
                        apagarCliente();
                    }
                );
            }
        );
    });
});

app.post('/salvar-servico', exigirAdmin, (req, res) => {
    const { descricao, preco, tempo_estimado } = req.body;
    if (!descricao || preco === undefined || tempo_estimado === undefined) {
        return res.status(400).send('Preencha todos os campos.');
    }
    const precoNum = parseFloat(preco);
    const tempoNum = parseInt(tempo_estimado, 10);
    if (isNaN(precoNum) || precoNum < 0 || isNaN(tempoNum) || tempoNum < 0) {
        return res.status(400).send('Preço e tempo inválidos.');
    }
    db.run(
        `INSERT INTO servicos (descricao, preco, tempo_estimado) VALUES (?, ?, ?)`,
        [descricao.trim(), precoNum, tempoNum],
        (err) => {
            if (err) return res.status(500).send('Erro: ' + err.message);
            res.redirect('/servicos.html');
        }
    );
});

app.get('/listar-servicos', exigirLogado, (req, res) => {
    db.all(`SELECT * FROM servicos ORDER BY descricao ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/finalizar-agendamento', exigirLogado, (req, res) => {
    let { cliente_id, data, responsavel, total, tempo_total, servicos } = req.body;

    if (req.user.tipo === 'cliente') {
        cliente_id = req.user.id;
        responsavel = responsavel || req.user.nome;
    }

    if (!cliente_id || !data || !responsavel || !Array.isArray(servicos) || servicos.length === 0) {
        return res.status(400).json({ success: false, error: 'Dados incompletos.' });
    }

    const totalNum = parseFloat(total);
    const tempoNum = parseInt(tempo_total, 10);
    if (isNaN(totalNum) || isNaN(tempoNum)) {
        return res.status(400).json({ success: false, error: 'Total ou tempo inválidos.' });
    }

    db.run(
        `INSERT INTO agendamentos (cliente_id, data, responsavel, total, tempo_total, entregue) VALUES (?, ?, ?, ?, ?, 0)`,
        [cliente_id, data, String(responsavel).trim(), totalNum, tempoNum],
        function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const agendamentoId = this.lastID;
            const stmt = db.prepare(
                `INSERT INTO itens_agendamento (agendamento_id, servico_id, preco_cobrado, quantidade) VALUES (?, ?, ?, ?)`
            );
            let erroDetalhe = null;
            servicos.forEach((item) => {
                if (erroDetalhe) return;
                const qtd = Math.max(1, parseInt(item.quantidade, 10) || 1);
                const precoUnit = parseFloat(item.preco) || 0;
                stmt.run(agendamentoId, item.id, precoUnit, qtd, (errRun) => {
                    if (errRun) erroDetalhe = errRun;
                });
            });
            stmt.finalize((errFinalize) => {
                if (erroDetalhe || errFinalize) {
                    return res.status(500).json({
                        success: false,
                        error: (erroDetalhe || errFinalize).message
                    });
                }
                res.json({ success: true, id: agendamentoId });
            });
        }
    );
});

app.get('/listar-agendamentos', exigirAdmin, (req, res) => {
    const sql = `
        SELECT a.id, a.data, a.responsavel, a.total, a.tempo_total,
               COALESCE(a.entregue, 0) as entregue, c.nome as nome_cliente
        FROM agendamentos a
        INNER JOIN clientes c ON a.cliente_id = c.id
        ORDER BY COALESCE(a.entregue, 0) ASC, a.id DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/meus-agendamentos', exigirLogado, (req, res) => {
    if (req.user.tipo !== 'cliente') {
        return res.status(403).json({ error: 'Rota apenas para clientes.' });
    }
    const sql = `
        SELECT a.id, a.data, a.responsavel, a.total, a.tempo_total,
               COALESCE(a.entregue, 0) as entregue, c.nome as nome_cliente
        FROM agendamentos a
        INNER JOIN clientes c ON a.cliente_id = c.id
        WHERE a.cliente_id = ?
        ORDER BY COALESCE(a.entregue, 0) ASC, a.id DESC`;
    db.all(sql, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/detalhes-agendamento/:id', exigirLogado, (req, res) => {
    const { id } = req.params;
    const sqlItens = `
        SELECT i.preco_cobrado, COALESCE(i.quantidade, 1) as quantidade, s.descricao, s.tempo_estimado
        FROM itens_agendamento i
        INNER JOIN servicos s ON i.servico_id = s.id
        WHERE i.agendamento_id = ?`;

    if (req.user.tipo === 'admin') {
        return db.all(sqlItens, [id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    }

    db.get(`SELECT cliente_id FROM agendamentos WHERE id = ?`, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row || row.cliente_id !== req.user.id) {
            return res.status(403).json({ error: 'Pedido não encontrado.' });
        }
        db.all(sqlItens, [id], (err2, rows) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json(rows);
        });
    });
});

app.post('/marcar-entregue/:id', exigirAdmin, (req, res) => {
    const { id } = req.params;
    const entregue = req.body && req.body.entregue === 0 ? 0 : 1;
    db.run(
        `UPDATE agendamentos SET entregue = ? WHERE id = ?`,
        [entregue, id],
        function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
            }
            res.json({ success: true, entregue });
        }
    );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('====================================================');
    console.log('🚀 Bem Caseiro na porta ' + PORT);
    console.log('👤 Cliente: cadastro com nome + CPF');
    console.log('🔑 Admin: Willian / paesedelicias');
    console.log('====================================================');
});
