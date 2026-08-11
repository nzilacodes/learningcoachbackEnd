# Auditoria de Arquitetura — Estado Atual

**Projeto:** Learning English with Coach
**Data:** 11/08/2026 (atualizado — substitui a versão de 20/07/2026, que descrevia o monólito antigo)
**Método:** revisão do código-fonte dos dois repositórios (`learningcoach` frontend, `learningcoachbackEnd` backend), execução real de `npm run typecheck`/`npm run lint`, testes de endpoint contra o backend rodando localmente e contra o banco de produção.

## Decisão executiva

A separação frontend/backend recomendada na auditoria anterior **já foi implementada**. `learningcoach` (React 19 + TanStack Start/Router) não importa `@supabase/supabase-js` em lugar nenhum e não faz nenhuma chamada direta a `supabase.from`/`supabase.rpc`/`supabase.auth`. Todo acesso a dados passa por `src/lib/api/client.ts`, que fala com `learningcoachbackEnd` — uma API REST própria em Fastify, versionada sob `/v1/...`, com cerca de 80 endpoints cobrindo autenticação, currículo/progresso, diagnóstico, exames de nível, gamificação, faturamento, certificados, IA (chat/leitura/pronúncia/TTS/STT/dicionário), comunidade, contacto e administração.

O backend fala com o Postgres diretamente via `postgres.js` (pacote `postgres`), sem PostgREST, sem GoTrue/Supabase Auth e sem RLS como camada de autorização — a autorização é feita inteiramente na aplicação (`requireAuth`/`requireRole` em `src/plugins/`). Sessão é JWT (`jose`) em cookie `HttpOnly`, com refresh token opaco rotativo guardado com hash, e proteção CSRF por double-submit token. O deploy do backend é automatizado (`.github/workflows/deploy.yml`, build + rsync + restart systemd num VPS a cada push em `main`).

## 1. Arquitetura atual

```text
Browser / React 19 (learningcoach)
 └─ src/lib/api/client.ts → fetch(`${VITE_API_URL}/v1/...`, { credentials: "include" })
                         │
Fastify (learningcoachbackEnd)
 ├─ src/app.ts — CORS, cookie, rate limit, multipart, registro dos módulos
 ├─ src/plugins/{auth,roles,csrf,db,error-handler}.ts
 └─ src/modules/{auth,users,learning,exams,diagnostic,gamification,
                 billing,certificates,ai,admin,community,contact}/
        routes.ts → service.ts → repository.ts (postgres.js, SQL parametrizado)
                         │
Postgres (mesmo banco que já existia, hoje hospedado na Supabase mas acessado
          via connection string direta/pooler — não via SDK Supabase)
                         │
OpenAI (chat, TTS, STT, dicionário, avaliação de leitura/pronúncia,
        study-pack de vídeo) — via src/lib/ai-gateway.ts
```

## 2. Inventário de endpoints por módulo (`/v1/...`)

| Módulo | Endpoints (resumo) |
| --- | --- |
| `auth` | register, login, refresh, logout, forgot/reset/change-password, `GET /me` |
| `users` | `PATCH /me`, admin: listar/ver/editar/apagar utilizador |
| `learning` | `GET /courses`, `GET/POST /me/progress`, `GET /lessons/:id` (público), `POST /lessons/:id/complete`, study-stats/sessions/time/reminder, video-history, admin: `PATCH /admin/lessons/:id`, CRUD de `exercises` |
| `exams` | exame por nível, submissão, tentativas, nível/pontuação mínima desbloqueados |
| `diagnostic` | submissão do teste de nivelamento, último resultado |
| `gamification` | eventos de XP, stats, missões, loja/inventário, conquistas, leaderboard, rank, amigos, `GET /games/plays` |
| `billing` | planos, checkout, pagamentos/assinaturas próprias, simulação sandbox, admin: stats/pagamentos/assinaturas |
| `certificates` | emitir, listar próprios, verificar por código (público) |
| `ai` | TTS, STT, dicionário, avaliação de leitura/pronúncia, study-pack de vídeo, conversas do AI Coach (`GET/POST /ai/conversations`, mensagens) |
| `community` | mensagens por sala etária (polling REST) |
| `contact` | `POST /contact` (público, rate-limited) |
| `admin` | analytics, resumo de segurança, audit-logs, tentativas de login, bloqueios, relatórios (users/payments/diagnostics) |

Todas as rotas de escrita usam Zod para validação. Rotas administrativas exigem `requireAuth + requireRole("admin")`. `GET /lessons/:id` é pública (permite a landing page linkar uma lição real como demonstração), mas o gabarito de exercícios (`correct_answer`) só é enviado a chamadas autenticadas.

## 3. O que ainda não está feito / limitações conhecidas

- **Conteúdo pedagógico das lições:** o schema e o pipeline (leitura, escrita, autoria admin) estão prontos, mas de 1.584 lições semeadas só 12 (uma unidade, A1 "Greetings & Introductions") têm conteúdo real — o resto tem placeholder de geração automática ("term_1", "Original definition to be edited..."). Trabalho editorial contínuo, não técnico.
- **Pagamento real:** não há integração com gateway (Multicaixa/EMIS/AppyPay). Pagamentos são ativados manualmente por um admin, ou simulados em modo sandbox (`SANDBOX_PAYMENTS_ENABLED`, deve ficar `false` em produção).
- **Segredos:** confirmar que `.env` real nunca foi commitado nos históricos dos dois repositórios; `.gitignore` já cobre `.env*` (exceto `.env.example`).
- **CI/lint:** o frontend tem uma pasta `Design/` (export de ferramenta de design) fora de `src/`, agora excluída do lint via `eslint.config.js`. Há uma quantidade de erros de formatação Prettier pré-existentes em arquivos não relacionados ao backend (fora do escopo desta auditoria).
- **Cooldown de XP em jogos, sincronização de formulários no admin, ordenação defensiva de lições:** mitigados nesta revisão; ver histórico de commits recentes de `learning`/`gamification` para detalhes.

## 4. Segurança — estado atual (comparado à auditoria anterior)

| Item da auditoria anterior | Estado atual |
| --- | --- |
| SEC-API-01 (TTS/STT/diagnóstico sem auth/quota) | Resolvido — todas as rotas de IA exigem `requireAuth` e têm rate limit dedicado (20/min) |
| SEC-PAY-01 (pagamento simulado sem controlo) | Mitigado — `simulate` só funciona com `SANDBOX_PAYMENTS_ENABLED=true`; ativação real é feita por admin autenticado |
| SEC-CERT-01 (emissão livre de certificado) | Resolvido — emissão é uma rota de serviço no backend, não escrita direta em tabela |
| SEC-DATA-01 (RLS como única barreira) | Resolvido de outra forma — não há mais acesso PostgREST do cliente; a API é a única porta de escrita, autorização feita em `requireAuth`/`requireRole` |
| SEC-AI-02 (`getWordData` sem auth) | Resolvido — atrás de `requireAuth` |
| SEC-SESSION-01 (sessão em localStorage) | Resolvido — cookies `HttpOnly`, `Secure` (produção), `SameSite` |
| SEC-ADMIN-01 (guard de admin inconsistente) | Resolvido — `requireRole("admin")` uniforme em todas as rotas `/admin/*` |
| SEC-SECRETS-01 (`.env` rastreado) | A confirmar — `.gitignore` já cobre, mas recomenda-se verificar o histórico git de ambos os repositórios |

## 5. Pontos fortes atuais

- Separação limpa `routes → service → repository` em todos os módulos, com Zod em toda entrada e erro padronizado (`problem+json`, RFC 9457) no `error-handler`.
- Migrações versionadas em `supabase/migrations/`, aplicadas por um runner próprio (`src/db/migrate.ts`, tabela `schema_migrations`), sem depender do CLI da Supabase.
- Convites a XP/recompensas calculados e validados no servidor (o cliente nunca controla o valor concedido).
- Cobertura de teste manual ponta-a-ponta feita nesta sessão: endpoints novos testados contra o banco real, typecheck limpo nos dois projetos.
