# InfoPago RH — Guia de Instalação

Sistema completo de RH com cadastro de funcionários CLT, geração de holerites,
PDFs e envio automático por e-mail.

---

## ✅ O que você precisa

- **Node.js 18+** ([nodejs.org](https://nodejs.org))
- **Conta Supabase** (gratuita) — [supabase.com](https://supabase.com)
- **Gmail com 2-Factor** habilitado (para SMTP via Senha de App)

---

## 🚀 Instalação rápida (4 passos)

### 1. Subir o schema no Supabase

1. Acesse [app.supabase.com](https://app.supabase.com)
2. Vá em **SQL Editor → New query**
3. Cole o conteúdo de **`supabase/schema.sql`** e clique em **Run**
4. Crie seu primeiro usuário em **Authentication → Users → Add user**
5. Volte ao SQL Editor e execute:
   ```sql
   INSERT INTO user_profiles (id, full_name, role)
   SELECT id, 'Administrador', 'admin'
   FROM auth.users
   WHERE email = 'seu@email.com';
   ```

### 2. Configurar `.env`

O arquivo já vem pré-preenchido com suas credenciais. Confira se está OK:
```env
PORT=3001
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
```

### 3. Instalar dependências

Abra o **PowerShell** na pasta do projeto:
```powershell
cd "C:\Users\gabig\Downloads\Sistema RH"
npm install
```
> Na primeira vez, o Puppeteer baixa o Chromium (~150MB, ~2 min)

### 4. Iniciar

```powershell
npm start
```
Acesse **http://localhost:3001**

---

## 🆕 O que tem de novo (v1.1)

✅ **Bug UUID corrigido** — campos vazios (departamento, cargo) são tratados como NULL.
✅ **Tabelas tributárias 2026** — INSS, IRRF, FGTS e Salário-família atualizados; sistema multi-ano (usa a tabela correta conforme o ano da competência).
✅ **CRUD de Cargos e Departamentos** nas Configurações.
✅ **Pop-up completo do funcionário** — clique no nome para ver tudo: faltas, atestados, advertências, aumentos salariais, histórico de holerites e férias.
✅ **Validação visual** — campos obrigatórios não preenchidos ficam **vermelhos** e aparece um **toast** no canto inferior direito listando o que falta.
✅ **Holerite PDF tradicional** — padrão clássico (Cód./Descrição/Referência/Vencimentos/Descontos) com bases de cálculo (INSS, FGTS, IRRF) no rodapé.
✅ **Envio automático** — o PDF é anexado ao e-mail com link de confirmação de recebimento.

---

## 📁 Estrutura

```
Sistema RH/
├── server.js                          ← Servidor Express
├── package.json
├── .env                               ← Credenciais (NÃO compartilhe!)
├── src/
│   ├── config/supabase.js             ← Cliente Supabase
│   ├── middleware/auth.js             ← JWT + roles
│   ├── routes/
│   │   ├── auth.js                    ← Login, usuários
│   │   ├── employees.js               ← CRUD funcionários + ficha completa
│   │   ├── departments.js             ← Departamentos
│   │   ├── positions.js               ← Cargos
│   │   ├── payslips.js                ← Holerites e PDFs
│   │   ├── email.js                   ← Envios e logs
│   │   ├── reports.js                 ← Dashboard
│   │   ├── settings.js                ← Empresa + SMTP
│   │   ├── warnings.js                ← Advertências
│   │   └── absences.js                ← Faltas/atestados
│   ├── services/
│   │   ├── payroll.js                 ← Motor CLT (multi-ano: 2025, 2026...)
│   │   ├── pdf.js                     ← Geração PDF (Puppeteer)
│   │   └── emailService.js            ← Envio via Gmail SMTP
│   └── utils/scheduler.js             ← Cron de envios automáticos
├── public/
│   ├── login.html
│   ├── dashboard.html
│   ├── employees.html                 ← Lista + pop-up completo
│   ├── employee-form.html             ← Cadastro/edição (4 abas)
│   ├── payslips.html                  ← Lista + lote
│   ├── payslip-view.html              ← Detalhe individual
│   ├── email-send.html                ← Envios e agendamentos
│   ├── settings.html                  ← Empresa, SMTP, deptos, cargos
│   ├── css/main.css                   ← Design system (com validação vermelha)
│   └── js/api.js                      ← API client + toast + validação
├── templates/
│   └── holerite.html                  ← Template PDF tradicional
├── supabase/
│   └── schema.sql                     ← Script de criação das tabelas
└── uploads/
    ├── holerites/{ano}/{mes}/         ← PDFs gerados
    └── fotos/                         ← Fotos dos funcionários
```

---

## 💰 Tabelas tributárias atualizadas (CLT 2026)

### INSS 2026 (progressivo)
| Faixa | Alíquota |
|-------|----------|
| Até R$ 1.564,18 | 7,5% |
| R$ 1.564,19 – R$ 2.879,00 | 9,0% |
| R$ 2.879,01 – R$ 4.319,00 | 12,0% |
| R$ 4.319,01 – R$ 8.406,21 | 14,0% |
| Teto INSS | R$ 980,72 |

### IRRF 2026
| Base | Alíquota | Dedução |
|------|----------|---------|
| Até R$ 2.428,80 | Isento | — |
| R$ 2.428,81 – R$ 2.985,00 | 7,5% | R$ 182,16 |
| R$ 2.985,01 – R$ 3.961,00 | 15% | R$ 410,03 |
| R$ 3.961,01 – R$ 4.927,68 | 22,5% | R$ 707,20 |
| Acima | 27,5% | R$ 953,55 |

- **Dependente:** R$ 200,00 cada
- **Salário-família:** R$ 65,00 por filho até 14 anos (teto: salário até R$ 1.906,04)
- **FGTS:** 8% sobre salário bruto (2% para aprendiz)

> ⚠ **Quando o Governo publicar a portaria 2027**, abra `src/services/payroll.js`,
> adicione um novo bloco em `TABELAS_TRIBUTARIAS` com a chave `2027:` e o
> sistema usará automaticamente conforme o ano da competência do holerite.

---

## 📋 Fluxo de uso

### 1. Configurar a empresa
- **Configurações → Empresa**: razão social, CNPJ, endereço
- **Configurações → E-mail**: Gmail + Senha de App (clique em "Testar conexão")
- **Configurações → Departamentos**: cadastre os departamentos
- **Configurações → Cargos**: cadastre cargos com CBO e faixa salarial

### 2. Cadastrar funcionários
- **Funcionários → Novo funcionário**
- 4 abas: Pessoal, Trabalho, Benefícios, Bancário
- Campos com `*` são obrigatórios — se faltar algum, ficam **vermelhos** e aparece toast

### 3. Gerar holerites
- **Holerites → + Gerar em lote**
- Escolha mês/ano + data de pagamento
- Filtro opcional por departamento
- Sistema calcula INSS, IRRF, FGTS automaticamente

### 4. Gerar PDFs
- Selecione os holerites e clique em **📄 PDFs (selecionados)**
- Ou gere individualmente clicando no botão 📄 de cada linha

### 5. Enviar por e-mail
- Selecione os holerites com PDF gerado e clique em **✉ Enviar**
- O funcionário recebe o PDF anexado + link para confirmar recebimento
- Você acompanha em **Envios → Histórico**

### 6. Acompanhar funcionário individual
- Clique no nome do funcionário na lista
- Pop-up com 6 abas: Dados, Holerites, Faltas/Atestados, Advertências, Histórico Salarial, Férias
- Pode registrar nova falta, atestado ou advertência direto do pop-up

---

## 🔧 Solução de problemas

### "Puppeteer falhou ao iniciar"
```powershell
npm run install:chromium
```

### "SMTP falhou ao conectar"
- Confirme que o Gmail tem 2FA ativado
- Use a **Senha de App** (16 caracteres SEM espaços), não a senha normal
- Em Configurações → E-mail, clique **🔧 Testar conexão**

### "Token inválido / não autenticado"
- Saia e entre novamente (Sair → Login)

### Tabelas tributárias desatualizadas
- Edite `src/services/payroll.js` e adicione o novo ano em `TABELAS_TRIBUTARIAS`

### Logs
- O servidor mostra todos os erros no terminal — se algo falhar, olhe lá primeiro

---

*InfoPago RH v1.1 · Node.js + Supabase + Puppeteer · Multi-ano CLT*
