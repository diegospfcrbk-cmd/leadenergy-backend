# LeadEnergy Backend

Backend Node.js para o sistema LeadEnergy com suporte a login e recuperação de senha.

## Instalação Local

```bash
npm install
cp .env.example .env
# Edite .env com suas credenciais do Mailtrap
npm run dev
```

## Deploy no Render

1. **Criar conta no Mailtrap** (grátis):
   - Acesse https://mailtrap.io
   - Crie uma conta
   - Vá para "Email Testing" > seu inbox
   - Clique em "Integrations" > "Nodemailer"
   - Copie o `user` e `pass`

2. **Fazer deploy no Render**:
   - Crie um novo "Web Service" no Render
   - Conecte este repositório GitHub
   - Configure as variáveis de ambiente:
     ```
     MAILTRAP_USER=seu-usuario
     MAILTRAP_PASS=sua-senha
     FRONTEND_URL=https://seu-frontend.vercel.app
     JWT_SECRET=uma-chave-super-secreta
     ```
   - Deploy!

## Endpoints

- `POST /api/login` - Login
  ```json
  {
    "email": "user@example.com",
    "senha": "password"
  }
  ```

- `POST /api/registrar` - Registrar novo usuário
  ```json
  {
    "email": "user@example.com",
    "senha": "password",
    "nome": "João"
  }
  ```

- `POST /api/recuperar-senha` - Solicitar reset de senha
  ```json
  {
    "email": "user@example.com"
  }
  ```

- `POST /api/validar-token` - Validar token de reset
  ```json
  {
    "token": "token-recebido"
  }
  ```

- `POST /api/redefinir-senha` - Redefinir senha
  ```json
  {
    "token": "token-recebido",
    "nova_senha": "nova-senha"
  }
  ```

- `GET /api/health` - Health check
