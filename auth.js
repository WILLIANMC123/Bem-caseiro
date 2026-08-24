/* Sessão e menu de perfil - Bem Caseiro */
const BC_SESSION_KEY = 'bem_caseiro_session';

function bcGetSession() {
    try {
        const raw = localStorage.getItem(BC_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function bcSetSession(data) {
    localStorage.setItem(BC_SESSION_KEY, JSON.stringify(data));
}

function bcClearSession() {
    localStorage.removeItem(BC_SESSION_KEY);
}

function bcAuthHeaders() {
    const s = bcGetSession();
    if (!s || !s.token) return {};
    return { Authorization: 'Bearer ' + s.token };
}

function bcIsAdmin() {
    const s = bcGetSession();
    return s && s.tipo === 'admin';
}

function bcIsCliente() {
    const s = bcGetSession();
    return s && s.tipo === 'cliente';
}

function bcRequireLogin() {
    const s = bcGetSession();
    if (!s || !s.token) {
        window.location.href = 'index.html';
        return null;
    }
    return s;
}

function bcRequireAdmin() {
    const s = bcRequireLogin();
    if (!s) return null;
    if (s.tipo !== 'admin') {
        window.location.href = 'home.html';
        return null;
    }
    return s;
}

function bcLogout() {
    bcClearSession();
    window.location.href = 'index.html';
}

function bcEscape(text) {
    if (text == null) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function bcRenderChrome(activePage) {
    const s = bcGetSession();
    if (!s) return;

    const isAdmin = s.tipo === 'admin';
    const nome = (s.usuario && s.usuario.nome) || (isAdmin ? 'Admin' : 'Cliente');

    let links = '';
    if (isAdmin) {
        links = `
            <a href="home.html" class="${activePage === 'home' ? 'ativo' : ''}">Home</a>
            <a href="clientes.html" class="${activePage === 'clientes' ? 'ativo' : ''}">Clientes</a>
            <a href="servicos.html" class="${activePage === 'servicos' ? 'ativo' : ''}">Produtos</a>
            <a href="agendamentos.html" class="${activePage === 'agendamentos' ? 'ativo' : ''}">Pedidos</a>
            <a href="consulta_agendamentos.html" class="${activePage === 'consulta' ? 'ativo' : ''}">Consulta</a>
        `;
    } else {
        links = `
            <a href="home.html" class="${activePage === 'home' ? 'ativo' : ''}">Home</a>
            <a href="servicos.html" class="${activePage === 'servicos' ? 'ativo' : ''}">Produtos</a>
            <a href="agendamentos.html" class="${activePage === 'agendamentos' ? 'ativo' : ''}">Novo Pedido</a>
            <a href="meus_pedidos.html" class="${activePage === 'meus' ? 'ativo' : ''}">Meus Pedidos</a>
        `;
    }

    const clientesBox = isAdmin
        ? `<div class="bc-perfil-clientes" id="bc-perfil-clientes">
                <div class="bc-perfil-clientes-titulo">Pessoas cadastradas</div>
                <div class="bc-perfil-clientes-lista" id="bc-perfil-clientes-lista">
                    <small style="color:#888;">Carregando...</small>
                </div>
                <a href="clientes.html" class="bc-perfil-link-clientes">Ver todos / cadastrar →</a>
           </div>`
        : '';

    const nav = document.querySelector('nav.bc-nav') || document.querySelector('nav');
    if (nav) {
        nav.classList.add('bc-nav');
        nav.innerHTML = `
            <div class="bc-nav-links">${links}</div>
            <div class="bc-perfil-wrap">
                <button type="button" class="bc-perfil-btn" id="bc-perfil-btn" aria-expanded="false">
                    <span class="bc-perfil-avatar">${bcEscape(nome.charAt(0).toUpperCase())}</span>
                    <span class="bc-perfil-nome">${bcEscape(nome)}</span>
                    <span class="bc-perfil-seta">▾</span>
                </button>
                <div class="bc-perfil-menu" id="bc-perfil-menu" hidden>
                    <div class="bc-perfil-info">
                        <strong>${bcEscape(nome)}</strong>
                        <small>${isAdmin ? 'Administrador' : 'Cliente'}</small>
                    </div>
                    ${clientesBox}
                    <button type="button" class="bc-sair" id="bc-sair">Sair da conta</button>
                </div>
            </div>
        `;

        const btn = document.getElementById('bc-perfil-btn');
        const menu = document.getElementById('bc-perfil-menu');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = menu.hidden;
            menu.hidden = !open;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open && isAdmin) carregarClientesNoPerfil();
        });
        document.getElementById('bc-sair').addEventListener('click', bcLogout);
        document.addEventListener('click', () => {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        });
        menu.addEventListener('click', (e) => e.stopPropagation());
    }
}

async function carregarClientesNoPerfil() {
    const lista = document.getElementById('bc-perfil-clientes-lista');
    if (!lista) return;
    try {
        const res = await fetch('/listar-clientes', { headers: bcAuthHeaders() });
        if (res.status === 401) return bcLogout();
        const clientes = await res.json() || [];
        if (!clientes.length) {
            lista.innerHTML = '<small style="color:#888;">Nenhum cliente cadastrado.</small>';
            return;
        }
        lista.innerHTML = clientes.map(c => `
            <div class="bc-cliente-item">
                <strong>${bcEscape(c.nome)}</strong>
                <div class="bc-cliente-dados">
                    <span>CPF: ${bcEscape(c.cpf || '-')}</span>
                    <span>Tel: ${bcEscape(c.telefone || '-')}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        lista.innerHTML = '<small style="color:#c0392b;">Erro ao carregar.</small>';
    }
}

/** 0 = feito hoje; 1 = ontem; n = há n dias */
function formatarQuandoFeito(dias) {
    const n = parseInt(dias, 10);
    if (isNaN(n) || n < 0) return '—';
    if (n === 0) return 'Feito hoje';
    if (n === 1) return 'Feito ontem';
    if (n === 2) return 'Feito há 2 dias';
    if (n <= 7) return 'Feito há ' + n + ' dias';
    return 'Feito há mais de uma semana';
}
