# InfoPago RH

Sistema completo de Recursos Humanos e Folha de Pagamento para empresas brasileiras (CLT).

Desenvolvido em **Node.js + Express + Supabase + Puppeteer**, com identidade visual fintech (verde escuro + neon).

---

## ✨ Funcionalidades

### Cadastros
- 👥 Funcionários com ficha completa (4 abas: pessoal, trabalho, benefícios, bancário)
- 📷 Foto do funcionário (Supabase Storage)
- 🏛 Departamentos e cargos com CBO
- 🪪 Multi-usuário com perfis: **admin**, **rh**, **gestor**

### Folha de pagamento
- 💰 Cálculo CLT automatizado (INSS, IRRF, FGTS, salário-família)
- 📅 Tabelas tributárias **multi-ano** (2025 e 2026, fácil adicionar novos anos)
- 📄 Holerites em PDF com **2 páginas**: tradicional + espelho de ponto
- ⚡ Horas extras calculadas automaticamente do controle de ponto (sábado=50%, domingo/feriado=100%, excedente=50%)
- 📤 Geração em lote por departamento

### Controle de ponto
- ⏱ Bate-ponto com 4 marcações por dia
- 📊 Espelho mensal estilo planilha contábil
- 🏦 Banco de horas acumulado
- 🎉 Feriados nacionais embutidos (algoritmo de Meeus para Páscoa/Carnaval/Corpus)
- 🏖 Sábado/domingo/feriado = dia de descanso (sem horas faltantes)

### Férias, faltas e ocorrências
- 📋 Faltas e atestados (com CID e médico)
- ⚠ Advertências (verbal/escrita/suspensão/justa causa)
- 💼 Histórico salarial automático
- 🏖 Solicitação de férias com fluxo de aprovação gestor → RH

### Admissão e Demissão
- ✅ Checklist de onboarding (11 itens padrão CLT)
- ✅ Checklist de offboarding (11 itens padrão CLT)
- Progresso visual e marcação item a item

### Documentos
- 📎 Anexar RG, CTPS, exames, contratos (Supabase Storage privado)
- 🔒 URLs assinadas (validade 1 hora)
- Validade com alerta de vencimento

### Envio automático
- ✉ E-mail com PDF anexado + link de confirmação
- ⏰ Agendamento cron (07:55 e 08:05 diários)
- 📊 Histórico de envios com confirmação

### Central de Ajuda
- 📖 FAQ pesquisável
- 📞 Contatos úteis (DP, RH, sindicato, médico…)
- 📃 Documentos da empresa (políticas, manuais)
- 📢 Comunicados e avisos
- 📅 Calendário RH (feriados, aniversários, férias, vencimentos)
- 🧮 Calculadora de salário líquido CLT 2026

---

## 🛠 Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 18+ · Express 4 |
| Banco de dados | Supabase (PostgreSQL 17) com Row Level Security |
| Autenticação | Supabase Auth (JWT) |
| Storage | Supabase Storage (fotos públicas, documentos privados) |
| Geração PDF | Puppeteer (Chromium headless) |
| E-mail | Nodemailer + Gmail SMTP (Senha de App) |
| Scheduler | node-cron |
| Frontend | HTML/CSS/JS puro · Inter + Source Serif 4 + JetBrains Mono |
| Design | Identidade própria · paleta verde InfoPago |

---

## 🚀 Instalação local

### Pré-requisitos
- [Node.js 18+](https://nodejs.org)
- Conta gratuita em [Supabase](https://supabase.com)
- Gmail com **Verificação em 2 etapas** habilitada

### Passo a passo

```bash
# 1. Clonar
git clone https://github.com/SEU-USUARIO/infopago-rh.git
cd infopago-rh

# 2. Instalar dependências (Puppeteer baixa o Chromium ~150MB)
npm install

# 3. Copiar e preencher o arquivo de configuração
cp .env.example .env
# edite .env com suas credenciais do Supabase e Gmail

# 4. No Supabase: SQL Editor → cole o conteúdo de supabase/schema.sql → Run
# Isso cria as tabelas e Storage buckets necessários

# 5. Crie o usuário admin
# No Supabase: Authentication → Users → Add user (com e-mail + senha)
# Depois rode no SQL Editor:
# INSERT INTO user_profiles (id, full_name, role)
# SELECT id, 'Seu Nome', 'admin' FROM auth.users WHERE email = 'seu@email.com';

# 6. Iniciar
npm start
```

Acesse: **http://localhost:3001**

---

## 📁 Estrutura

```
infopago-rh/
├── server.js                       # Servidor Express
├── package.json
├── .env.example                    # Modelo das variáveis (sem chaves reais)
├── README.md
│
├── src/
│   ├── config/supabase.js          # Cliente Supabase (service role)
│   ├── middleware/auth.js          # Validação JWT + roles
│   ├── routes/                     # 14 routers de API
│   │   ├── auth.js
│   │   ├── employees.js
│   │   ├── departments.js
│   │   ├── positions.js
│   │   ├── payslips.js
│   │   ├── email.js
│   │   ├── reports.js
│   │   ├── settings.js
│   │   ├── warnings.js
│   │   ├── absences.js
│   │   ├── documents.js
│   │   ├── time.js
│   │   ├── vacationRequests.js
│   │   ├── checklists.js
│   │   └── help.js
│   ├── services/
│   │   ├── payroll.js              # Motor CLT (INSS, IRRF, FGTS)
│   │   ├── pdf.js                  # Puppeteer + template
│   │   ├── emailService.js         # Nodemailer
│   │   └── holidays.js             # Feriados nacionais (algoritmo Meeus)
│   └── utils/
│       ├── scheduler.js            # cron de envios
│       └── pontoExtras.js          # cálculo de HE pelo ponto
│
├── public/                         # Frontend
│   ├── login.html
│   ├── dashboard.html
│   ├── employees.html              # Lista + pop-up completo (8 abas)
│   ├── employee-form.html
│   ├── payslips.html
│   ├── payslip-view.html
│   ├── email-send.html
│   ├── settings.html
│   ├── time.html                   # Controle de ponto
│   ├── vacations.html              # Solicitações de férias
│   ├── help.html                   # Central de ajuda (6 abas)
│   ├── css/main.css                # Design system
│   └── js/api.js                   # API client + UI helpers
│
├── templates/
│   └── holerite.html               # Template PDF (2 páginas)
│
├── supabase/
│   └── schema.sql                  # Schema completo
│
└── uploads/                        # Local (PDFs gerados)
    ├── holerites/{ano}/{mes}/
    └── fotos/                      # (migrado pro Supabase Storage)
```

---

## 💰 Tabelas tributárias CLT 2026

### INSS (progressivo)
| Faixa | Alíquota |
|---|---|
| Até R$ 1.564,18 | 7,5% |
| R$ 1.564,19 – 2.879,00 | 9,0% |
| R$ 2.879,01 – 4.319,00 | 12,0% |
| R$ 4.319,01 – 8.406,21 | 14,0% |
| Teto INSS | R$ 980,72 |

### IRRF
| Base | Alíquota | Dedução |
|---|---|---|
| Até R$ 2.428,80 | Isento | — |
| R$ 2.428,81 – 2.985,00 | 7,5% | R$ 182,16 |
| R$ 2.985,01 – 3.961,00 | 15% | R$ 410,03 |
| R$ 3.961,01 – 4.927,68 | 22,5% | R$ 707,20 |
| Acima | 27,5% | R$ 953,55 |

- **Dependente:** R$ 200,00 cada
- **Salário-família:** R$ 65,00 por filho (teto R$ 1.906,04)
- **FGTS:** 8% (2% para aprendiz)

> ℹ Para adicionar a tabela 2027 quando o governo publicar, edite `src/services/payroll.js` → bloco `TABELAS_TRIBUTARIAS`. O sistema usa automaticamente a tabela do ano da competência.

---

## 🔐 Segurança

- **JWT** via Supabase Auth com refresh token
- **Row Level Security** habilitado em todas as tabelas
- **Rate limiting** no login (20 req / 15 min) e na API geral (200 req / min)
- **Helmet** para hardening de headers HTTP
- **Service Role Key** usada apenas no backend (nunca exposta no frontend)
- **Documentos privados** acessados via URL assinada com validade de 1 hora

---

## 🧪 Roadmap

### Fase 2 (próxima)
- 📊 Relatórios analíticos (turnover, headcount, custo médio, absenteísmo)
- 🎯 Recrutamento básico (vagas + candidatos + pipeline)
- ⭐ Avaliação de desempenho simples

### Fase 3 (futura)
- 🏢 Multi-empresa
- 📑 eSocial / DIRF / RAIS
- 📱 PWA mobile para funcionários

---

## 📄 Licença

Uso privado. Todos os direitos reservados.

---

## 👤 Autor

**Gabriel Grosklags** · Simplifikk

*v1.1 · Build 2026-05*
