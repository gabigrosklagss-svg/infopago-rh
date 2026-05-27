#  Pasta de segredos — InfoPago RH

Esta pasta contém **credenciais sensíveis** e é tratada com camadas extras de proteção:

## Camadas de proteção aplicadas

| Camada | O que faz | Status |
|---|---|---|
| `.gitignore` | Bloqueia commit pro Git/GitHub |  Linha `secrets/` |
| **Sem rota HTTP** | Não é servida por `app.use('/uploads')` nem nada similar |  |
| **NTFS herança removida** | Não herda permissões da pasta-mãe |  `icacls /inheritance:r` |
| **Acesso restrito ao dono** | Só o usuário Windows que criou consegue ler |  `icacls /grant:r ${user}:(F)` |
| **Carregamento no startup** | Lido só uma vez quando o servidor inicia |  via `dotenv.config()` |

## Arquivos

- **`.env`** — todas as credenciais (Supabase, Gmail SMTP, Anthropic, JWT)
- **`README.md`** — este arquivo (explicativo, sem segredos)

##  Avisos importantes

- **Nunca** copie o conteúdo do `.env` para outros lugares (chat, e-mail, anotações)
- **Nunca** envie esta pasta por upload
- Se suspeitar que algum segredo vazou, **regenere imediatamente** no painel do serviço (Supabase / Anthropic / Gmail)
- Para produção real (deploy web), use cofre dedicado: Azure Key Vault, AWS Secrets Manager, Doppler ou Infisical
- Não commit nada com `git add secrets/` (mesmo que o `.gitignore` impeça, evite o hábito)

## Como adicionar uma nova credencial

1. Abra `secrets/.env` no Bloco de Notas
2. Adicione a linha no formato `NOME_VARIAVEL=valor` (sem aspas, sem espaços)
3. Salve o arquivo
4. Reinicie o servidor (`node server.js`) para o novo valor entrar em uso
5. Para usá-la no código: `process.env.NOME_VARIAVEL`

## Como verificar as permissões

No PowerShell, dentro da pasta raiz do projeto:

```powershell
icacls secrets
```

Deve mostrar apenas seu usuário Windows + SYSTEM, sem o grupo "Usuários autenticados".
