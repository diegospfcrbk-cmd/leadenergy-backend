import os, datetime, jwt
from functools import wraps
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from supabase import create_client, Client

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ['SECRET_KEY']         # obrigatório em produção
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

CREDITOS_TESTE = 20

def gerar_token(email):
    return jwt.encode(
        {'email': email, 'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)},
        app.config['SECRET_KEY'], algorithm='HS256')

def login_obrigatorio(f):
    @wraps(f)
    def wrapper(*a, **k):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        try:
            request.email = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])['email']
        except Exception:
            return jsonify({'erro': 'Não autorizado'}), 401
        return f(*a, **k)
    return wrapper

def usuario_por_email(email):
    r = supabase.table('usuarios').select('*').eq('email', email).execute()
    return r.data[0] if r.data else None

# ---------- CONTAS ----------
@app.route('/api/cadastro', methods=['POST'])
def cadastro():
    d = request.get_json() or {}
    email = d.get('email', '').strip().lower(); senha = d.get('senha')
    nome = d.get('nome'); whatsapp = d.get('whatsapp'); plano = d.get('plano', 'Starter')
    if not (email and senha and nome and whatsapp):
        return jsonify({'erro': 'Campos obrigatórios: nome, email, whatsapp, senha'}), 400
    if len(senha) < 6:
        return jsonify({'erro': 'Senha deve ter ao menos 6 caracteres'}), 400
    if supabase.table('usuarios').select('id').eq('email', email).execute().data:
        return jsonify({'erro': 'E-mail já cadastrado'}), 409
    payload = {'nome': nome, 'email': email, 'whatsapp': whatsapp,
               'senha_hash': generate_password_hash(senha),
               'plano': plano, 'status': 'PENDENTE_PAGAMENTO', 'creditos': CREDITOS_TESTE}
    u = supabase.table('usuarios').insert(payload).execute().data[0]
    u.pop('senha_hash', None)
    return jsonify({'sucesso': True, 'token': gerar_token(email), 'usuario': u}), 201

@app.route('/api/login', methods=['POST'])
def login():
    d = request.get_json() or {}
    email = d.get('email', '').strip().lower(); senha = d.get('senha')
    if not (email and senha):
        return jsonify({'erro': 'E-mail e senha obrigatórios'}), 400
    u = usuario_por_email(email)
    if not u or not check_password_hash(u.get('senha_hash', ''), senha):
        return jsonify({'erro': 'Credenciais inválidas'}), 401
    u.pop('senha_hash', None)
    return jsonify({'sucesso': True, 'token': gerar_token(email), 'usuario': u}), 200

# ---------- LEADS ----------
@app.route('/api/leads', methods=['GET'])
@login_obrigatorio
def buscar_leads():
    # contato (telefone/email/site) NÃO vai aqui — só após desbloquear
    q = supabase.table('leads').select(
        'cnpj,razao_social,nome_fantasia,segmento,porte,tensao,uf,municipio').eq('situacao', '02')
    for campo in ('uf', 'municipio', 'segmento', 'porte', 'tensao'):
        v = request.args.get(campo)
        if v:
            q = q.eq(campo, v)
    return jsonify({'leads': q.limit(int(request.args.get('limite', 20))).execute().data}), 200

@app.route('/api/leads/<cnpj>/desbloquear', methods=['POST'])
@login_obrigatorio
def desbloquear(cnpj):
    u = usuario_por_email(request.email)
    lead = supabase.table('leads').select('*').eq('cnpj', cnpj).execute().data
    if not lead:
        return jsonify({'erro': 'Lead não encontrado'}), 404
    ja = supabase.table('progresso_leads').select('id') \
        .eq('usuario_id', u['id']).eq('cnpj', cnpj).execute().data
    if not ja:  # só cobra na primeira vez (evita perda de crédito)
        if u['creditos'] <= 0:
            return jsonify({'erro': 'Sem créditos'}), 402
        supabase.table('progresso_leads').insert({'usuario_id': u['id'], 'cnpj': cnpj}).execute()
        supabase.table('usuarios').update({'creditos': u['creditos'] - 1}).eq('id', u['id']).execute()
    return jsonify({'sucesso': True, 'lead': lead[0]}), 200

@app.route('/api/meus-leads', methods=['GET'])
@login_obrigatorio
def meus_leads():
    u = usuario_por_email(request.email)
    prog = supabase.table('progresso_leads').select('cnpj').eq('usuario_id', u['id']).execute().data
    cnpjs = [p['cnpj'] for p in prog]
    if not cnpjs:
        return jsonify({'leads': []}), 200
    return jsonify({'leads': supabase.table('leads').select('*').in_('cnpj', cnpjs).execute().data}), 200

# ---------- PAGAMENTO (Asaas) ----------
@app.route('/api/webhook/asaas', methods=['POST'])
def webhook_asaas():
    evento = request.get_json() or {}
    if evento.get('event') in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'):
        email = (evento.get('payment') or {}).get('externalReference')  # setar no checkout = email do usuário
        if email:
            supabase.table('usuarios').update({'status': 'ATIVO'}).eq('email', email).execute()
    return jsonify({'sucesso': True}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
