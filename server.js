const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Database setup
const db = new sqlite3.Database('leadenergy.db', (err) => {
  if (err) console.error(err);
  else console.log('SQLite connected');
});

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS password_reset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Email setup (Mailtrap)
const transporter = nodemailer.createTransport({
  host: 'smtp.mailtrap.io',
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER || 'placeholder',
    pass: process.env.MAILTRAP_PASS || 'placeholder'
  }
});

// Routes

// Login
app.post('/api/login', (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
    if (err) return res.status(500).json({ erro: 'Erro no servidor' });

    if (!row) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    }

    const passwordMatch = await bcryptjs.compare(senha, row.password);

    if (!passwordMatch) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    }

    const token = jwt.sign(
      { id: row.id, email: row.email },
      process.env.JWT_SECRET || 'seu-secret-aqui',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      usuario: {
        id: row.id,
        email: row.email,
        nome: row.nome
      }
    });
  });
});

// Recuperar Senha - Solicitar
app.post('/api/recuperar-senha', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'Email é obrigatório' });
  }

  // Verificar se email existe
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) return res.status(500).json({ erro: 'Erro no servidor' });

    if (!user) {
      // Por segurança, não dizemos se email existe ou não
      return res.json({ mensagem: 'Se o e-mail existir, você receberá instruções' });
    }

    // Gerar token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hora

    db.run(
      'INSERT INTO password_reset (email, token, expires_at) VALUES (?, ?, ?)',
      [email, token, expiresAt],
      async (err) => {
        if (err) return res.status(500).json({ erro: 'Erro ao processar' });

        // Enviar email
        const resetLink = `${process.env.FRONTEND_URL || 'https://leadenergy-vercel-clean.vercel.app'}/reset-senha?token=${token}`;

        try {
          await transporter.sendMail({
            from: 'noreply@leadenergy.com',
            to: email,
            subject: 'Recuperar sua senha - LeadEnergy',
            html: `
              <h2>Recuperar Senha</h2>
              <p>Você solicitou a recuperação de senha.</p>
              <p><a href="${resetLink}" style="background: #28e070; color: #04160b; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Redefinir Senha</a></p>
              <p>Ou copie este link: ${resetLink}</p>
              <p>Este link expira em 1 hora.</p>
              <p>Se você não solicitou, ignore este email.</p>
            `
          });

          res.json({ mensagem: 'Instruções enviadas para seu e-mail' });
        } catch (error) {
          console.error('Erro ao enviar email:', error);
          res.status(500).json({ erro: 'Erro ao enviar email' });
        }
      }
    );
  });
});

// Recuperar Senha - Validar token
app.post('/api/validar-token', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ erro: 'Token é obrigatório' });
  }

  db.get(
    'SELECT * FROM password_reset WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
    [token],
    (err, row) => {
      if (err) return res.status(500).json({ erro: 'Erro no servidor' });

      if (!row) {
        return res.status(400).json({ erro: 'Token inválido ou expirado' });
      }

      res.json({ valido: true, email: row.email });
    }
  );
});

// Recuperar Senha - Redefinir
app.post('/api/redefinir-senha', (req, res) => {
  const { token, nova_senha } = req.body;

  if (!token || !nova_senha) {
    return res.status(400).json({ erro: 'Token e nova senha são obrigatórios' });
  }

  if (nova_senha.length < 6) {
    return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres' });
  }

  db.get(
    'SELECT * FROM password_reset WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
    [token],
    async (err, row) => {
      if (err) return res.status(500).json({ erro: 'Erro no servidor' });

      if (!row) {
        return res.status(400).json({ erro: 'Token inválido ou expirado' });
      }

      // Hash da nova senha
      const hashedPassword = await bcryptjs.hash(nova_senha, 10);

      // Atualizar senha do usuário
      db.run(
        'UPDATE users SET password = ? WHERE email = ?',
        [hashedPassword, row.email],
        (err) => {
          if (err) return res.status(500).json({ erro: 'Erro ao atualizar senha' });

          // Marcar token como usado
          db.run(
            'UPDATE password_reset SET used = 1 WHERE token = ?',
            [token],
            (err) => {
              if (err) console.error(err);

              res.json({ mensagem: 'Senha redefinida com sucesso' });
            }
          );
        }
      );
    }
  );
});

// Registrar novo usuário
app.post('/api/registrar', async (req, res) => {
  const { email, senha, nome } = req.body;

  // Validações
  if (!email || !senha || !nome) {
    return res.status(400).json({ erro: 'Email, senha e nome são obrigatórios' });
  }

  // Validar email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ erro: 'Email inválido' });
  }

  // Validar senha (mínimo 6 caracteres)
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres' });
  }

  // Validar nome (mínimo 3 caracteres)
  if (nome.trim().length < 3) {
    return res.status(400).json({ erro: 'Nome deve ter pelo menos 3 caracteres' });
  }

  try {
    const hashedPassword = await bcryptjs.hash(senha, 10);
    const emailLower = email.toLowerCase();

    db.run(
      'INSERT INTO users (email, password, nome) VALUES (?, ?, ?)',
      [emailLower, hashedPassword, nome.trim()],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ erro: 'Este email já está registrado' });
          }
          console.error('Erro ao registrar:', err);
          return res.status(500).json({ erro: 'Erro ao registrar usuário' });
        }

        // Gerar token automaticamente após registrar
        const token = jwt.sign(
          { id: this.lastID, email: emailLower },
          process.env.JWT_SECRET || 'seu-secret-aqui',
          { expiresIn: '24h' }
        );

        res.status(201).json({
          mensagem: 'Usuário registrado com sucesso',
          token,
          usuario: {
            id: this.lastID,
            email: emailLower,
            nome: nome.trim()
          }
        });
      }
    );
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ erro: 'Erro ao processar registro' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
