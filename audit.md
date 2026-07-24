# Auditoria de Arquitetura e Plano de Separação Frontend/Backend

**Projeto:** Learning English with Coach  
**Data:** 20/07/2026  
**Método:** revisão estática do código, das 35 migrações SQL e da configuração presentes no repositório. Não houve acesso à instância Supabase, a variáveis reais nem execução da aplicação: `node_modules` não está instalado e, por isso, `npm run lint` e `npm run build` não puderam localizar `eslint`/`vite`.

## Decisão executiva

O sistema é hoje um **monólito full-stack TanStack Start**, não uma aplicação com frontend e backend separados. React, SSR, rotas HTTP (`/api/*`), server functions, regras de negócio e clientes Supabase estão no mesmo `src`. Além disso, diversas telas chamam o Supabase diretamente a partir do browser. Isto torna o PostgREST/RPC do Supabase uma API pública de facto e distribui regras sensíveis entre UI, server functions e PostgreSQL.

A recomendação é evoluir para um **monólito modular com API REST versionada** antes de considerar microsserviços. O frontend deve consumir exclusivamente `/api/v1`; apenas o backend deve usar a chave service role e falar com Postgres/Supabase. Supabase pode continuar como Auth, PostgreSQL, Storage e Realtime, mas deixa de ser uma dependência importada pelo frontend.

Não publicar como plataforma paga, nem como emissora de certificados, enquanto os itens P0 abaixo não forem resolvidos.

## 1. Arquitetura atual e fluxo de execução

```text
Browser / React 19
 ├─ rotas TanStack em src/routes/*.tsx
 ├─ chamadas directas: supabase-js → Supabase Auth/PostgREST/RPC/Realtime
 ├─ chamadas internas: fetch('/api/tts|stt|diagnostic-evaluate')
 └─ server functions importadas de src/lib/*.functions.ts
                         │
TanStack Start / Nitro (src/start.ts, src/server.ts)
 ├─ middleware injeta Bearer token nas server functions
 ├─ handlers HTTP de /api/*
 ├─ funções autenticadas usam cliente Supabase com RLS
 └─ algumas funções usam service role e ignoram RLS
                         │
Supabase: Auth + Postgres/RLS/RPC + Realtime
                         │
Lovable AI Gateway (TTS, STT e chat)
```

### Estrutura e responsabilidades

| Local | Papel atual | Observação de arquitetura |
| --- | --- | --- |
| `src/routes` | 32 telas React, SSR e 3 endpoints HTTP | mistura delivery web, apresentação e API |
| `src/lib/*.functions.ts` | server functions para pagamento, certificados, IA, analytics, auditoria | são RPC internas do framework, não contrato REST estável |
| `src/integrations/supabase` | clientes client/server e middleware de token | fronteira de dados duplicada e exposta ao frontend |
| `src/components`, `hooks`, `assets`, `styles.css` | UI reutilizável, animações e design system | pertence integralmente ao frontend |
| `supabase/migrations` | esquema, RLS, triggers e funções PostgreSQL | contém regras de domínio importantes, mas sem testes/seeds |

O arranque é `src/server.ts`, que delega ao entrypoint de TanStack Start; `src/start.ts` instala o middleware de tratamento de erro e o `attachSupabaseAuth`. O roteamento é file-based, gerado em `src/routeTree.gen.ts`. No cliente, `AuthProvider` em `src/lib/auth.tsx` escuta a sessão Supabase e lê papéis em `user_roles`.

O domínio não possui uma camada única de aplicação. Exemplo: pagamento passa por checkout React → `createSubscriptionOrder` → RPC SQL; já o cancelamento administrativo é feito diretamente pelo React com `supabase.from(...).update(...)`. Progresso, XP, certificados e exames também alternam entre UI, RPC e banco.

## 2. Coração da aplicação e fluxo de dados

Os módulos de maior criticidade são: autenticação/autorização, pagamentos/assinaturas, certificação, conteúdo/progresso, avaliações com IA e comunidade. O fluxo típico é:

1. `auth.tsx` obtém e persiste a sessão no `localStorage`; o browser comunica diretamente com Supabase.
2. A UI lê/escreve tabelas e chama RPCs com RLS, ou aciona uma server function que extrai o Bearer token e cria cliente Supabase autenticado.
3. Server functions de IA chamam o Lovable Gateway; algumas usam `supabaseAdmin` (service role) para cache ou persistência.
4. O Postgres concentra integridade parcial em constraints, triggers e RPCs: pagamento, XP, missões, níveis, certificados, analytics e auditoria.

O estado de interface é sobretudo `useState`, efeitos locais e `AuthContext`; existe `@tanstack/react-query` como dependência, mas não como padrão transversal de cache/erro/invalidação. Preferências de idioma e faixa etária ficam em `localStorage`; sessão Supabase também. Não há store de domínio, máquina de estados para checkout/onboarding nem um cliente API unificado.

## 3. Inventário do frontend a desacoplar

### Páginas e rotas

Rotas públicas: `/`, `/about`, `/contact`, `/pricing`, `/curriculum`, `/cefr-levels`, `/maintenance`, `/sitemap.xml`, `/verify/$code`. Rotas de conta/produto: `/auth`, `/reset-password`, `/onboarding`, `/placement`, `/dashboard`, `/track`, `/lesson`, `/level-exam/$level`, `/pronunciation`, `/reading`, `/videos`, `/watch/$videoId`, `/games`, `/rewards`, `/community`, `/ai-coach`, `/subscription`, `/checkout/$planId`, `/certificates`, `/certificate`. Rotas administrativas: `/admin`, `/analytics`, `/audit`.

`components/ui` é o design system Radix/shadcn; `site-header`, `site-footer`, `word-card`, `onboarding-gate`, `dashboard/extras` e `admin/sections` são componentes de produto. `hooks`, `assets`, animações GSAP, `i18n`, temas etários, utilitários de áudio e geração local de PDF pertencem ao frontend. O frontend deve manter somente tipos DTO, formulários, componentes e um `api-client`; não deve importar `supabase`, server functions, tipos de tabelas gerados ou segredos.

### Pontos de acoplamento encontrados

- Chamadas diretas `supabase.from`/`rpc`/`auth` aparecem em ao menos 15 rotas e componentes, incluindo `admin`, `rewards`, `community`, `placement`, `onboarding`, `level-exam` e `watch`.
- Server functions em `src/lib/*.functions.ts` são importadas pela UI para assinatura, certificados, leitura, pronúncia, vídeos, analytics e auditoria.
- `/api/tts`, `/api/stt` e `/api/diagnostic-evaluate` são chamados por `fetch` relativo e fazem proxy do gateway de IA.
- Realtime Supabase é usado pela comunidade; não há WebSocket próprio nem SSE.
- A sessão é Bearer JWT do Supabase, com persistência em `localStorage`; não há cookie HTTP-only gerido pela aplicação.

## 4. Backend atual e reorganização necessária

Não há controllers, repositories ou services explícitos. As responsabilidades estão repartidas entre handlers, server functions e SQL. O backend alvo deve extrair estas capacidades:

| Domínio | Origem atual | Serviço/API alvo |
| --- | --- | --- |
| Identidade | `auth.tsx`, Supabase Auth, `auth-middleware.ts` | `AuthService`, guard JWT/OAuth, DTOs de perfil e papel |
| Currículo/progresso | `lesson`, `dashboard`, `learning.ts`, tabelas `courses`…`progress` | `LearningService`, repositórios e motor de tentativas |
| Diagnóstico/IA | endpoints `/api/*`, `reading/pronunciation/videos.functions` | `AiService` com quotas, validação, timeout e auditoria de custo |
| Assinaturas | `subscriptions.functions`, RPCs SQL | `BillingService`, adapter PSP, webhook e outbox |
| Certificados | `certificates.functions`, RPC SQL | `CertificationService` com elegibilidade transacional |
| Gamificação | `gamification.ts`, tabelas XP/missões/loja | `GamificationService`, comandos idempotentes |
| Comunidade | `community.tsx` e Realtime | `CommunityService`, moderação, denúncia e autorização |
| Administração | rotas e queries diretas | `AdminService`/queries paginadas, RBAC de servidor |

Use `controller → application service → domain → repository/infrastructure`. PostgreSQL/Supabase permanece em infrastructure; RPCs SQL podem sobreviver inicialmente atrás de repositories, mas não devem constituir o contrato público. Centralize DTOs Zod, erro RFC 9457/problem+json, paginação cursor, IDs de correlação, logs JSON e métricas.

## 5. Banco de dados

O esquema é rico: identidades/perfis/papéis; planos, assinaturas e pagamentos; cursos, unidades, aulas, exercícios, `progress` e `lesson_progress`; diagnóstico, exames, certificados; XP, missões, inventário e amizades; mensagens de comunidade; notificações; conversas/mensagens IA; avaliações de leitura/pronúncia/vocabulário/vídeo; auditoria e bloqueios de conta. Há chaves únicas e índices importantes, por exemplo em `(user_id, video_id)`, progresso, auditoria, avaliações, XP e mensagens por sala. RLS está habilitado na maioria das tabelas e há funções para papel, XP, compra, missões, limites de nível, pagamento e analytics.

Principais riscos de dados:

- `progress` e `lesson_progress` representam progresso em paralelo; o dashboard ainda tem `UNIT_DEFS` local. Definir um agregado canónico `LearningAttempt/LessonProgress`, migrar/backfill e descontinuar o outro.
- RLS permite ao utilizador inserir/alterar várias entidades próprias (`diagnostic_results`, tentativas de exame, inventário, XP em migração anterior). Como o browser tem acesso direto, não se pode confiar em pontuações, elegibilidade ou recompensas enviadas pelo cliente.
- `issue_certificate` aceita nível/curso/nota fornecidos pelo chamador e o certificado também possui política de INSERT do próprio utilizador. A elegibilidade deve ser calculada no servidor e a escrita direta removida.
- Faltam seeds idempotentes, testes de migração em banco vazio, documentação de rollback e prova de que índices/RLS estão aplicados no ambiente real.

## 6. Segurança — prioridades

| ID | Severidade | Evidência e impacto | Correção exigida |
| --- | --- | --- | --- |
| SEC-API-01 | Crítica | TTS, STT e diagnóstico aceitam POST anónimo, sem schema completo, quota, rate limit ou limite de payload; consomem `LOVABLE_API_KEY`. | autenticar, Zod, limite de tamanho/MIME/duração, rate limit por utilizador/IP/plano, timeout e medição de custo. |
| SEC-PAY-01 | Crítica | `simulatePaymentConfirmation` e a UI permitem confirmação simulada de pagamento. | remover de produção; PSP real com webhook assinado, idempotência e reconciliação. |
| SEC-CERT-01 | Crítica | emissão livre de certificado por nível e INSERT próprio. | somente serviço transacional calcula conclusão/exame; auditoria e revogação. |
| SEC-DATA-01 | Alta | acesso PostgREST/RPC direto pelo cliente transforma RLS em única barreira e permite forjar eventos próprios quando a política aceita escrita. | API como única porta de escrita de domínio; reduzir RLS a defesa em profundidade. |
| SEC-AI-02 | Alta | `getWordData` chama IA e escreve via service role sem `requireSupabaseAuth`. | autenticar, quota, cache controlado e validação. |
| SEC-SESSION-01 | Alta | sessão persistida no `localStorage`; um XSS pode exfiltrar token. | BFF com cookie `HttpOnly`, `Secure`, `SameSite=Lax/Strict`; CSP e proteção XSS. |
| SEC-ADMIN-01 | Alta | guard de admin é inconsistente; telas fazem queries diretas. | middleware `requireAuth` + `requireRole('admin')` em todo endpoint/rota protegida. |
| SEC-SECRETS-01 | Crítica | `.env` está rastreado e `.gitignore` não o ignora. | revogar/rotacionar segredos, remover do histórico de forma coordenada, `.env.example`, secret manager e scanner CI. |

Também faltam CORS explícito no futuro backend, proteção CSRF/origin se usar cookies, limitação de login/contato, headers de segurança, políticas de upload/antivírus, mascaramento de PII em logs e testes de autorização por papel. A moderação de comunidade no cliente não é barreira de segurança, especialmente num produto potencialmente usado por menores.

## 7. Performance e qualidade

- Páginas muito grandes concentram dados, UI e efeitos: `placement.tsx` tem 1.043 linhas; `onboarding`, `index`, `dashboard`, `curriculum`, `lesson`, `watch` e `rewards` têm 400–671 linhas. Separar containers, componentes e hooks por caso de uso.
- Admin carrega até 5.000 linhas para exportação e faz agregações/junções no cliente. Comunidade volta a carregar até 200 mensagens por evento realtime. Introduzir cursor, projections e eventos incrementais.
- Não há testes unitários, integração, E2E, contract tests, CI/CD, observabilidade ou workers/filas. `expire_subscriptions` existe sem agendamento versionado/documentado.
- Há cache de conteúdo de IA em tabelas, o que é um ponto positivo, mas não há TTL, invalidação, limites de custo ou telemetria.

## 8. Pontos fortes

- React 19, TypeScript, TanStack Router/Start e Zod já oferecem uma boa base técnica.
- Migrações versionadas, RLS e muitas constraints/índices são melhores que um protótipo puramente client-side.
- O middleware das server functions propaga o token do utilizador, e alguns casos de uso já usam validação Zod e service role somente no servidor.
- Modelagem cobre bem os domínios educacional, gamificação, auditoria e assinatura; há funções SQL transacionais reutilizáveis.
- Componentes UI, assets, i18n, animações e hooks têm separação visual razoável e podem ser migrados com baixo risco.

## 9. Arquitetura final recomendada

```text
apps/
  web/                 React + Vite/TanStack Router; somente UI e api-client
  api/                 Node/TypeScript (Fastify ou Nest), REST /api/v1
packages/
  contracts/           DTOs Zod, tipos e cliente HTTP gerado/manual
  domain/              entidades, políticas e casos de uso puros
  config/              lint, tsconfig e utilitários partilhados
api/src/modules/
  auth, users, learning, assessments, ai, billing,
  certificates, gamification, community, admin, notifications
  └─ presentation/controllers → application/services → domain → infrastructure/repositories
infra/
  supabase/migrations, seeds, worker, IaC, observability
```

Escolher REST, não GraphQL: os recursos e ações são claros, a cache/paginação são simples e as operações de escrita precisam de autorização rigorosa. GraphQL só se justifica se surgir necessidade real de composição flexível por múltiplos clientes. O backend valida JWT do Supabase/OAuth2 ou emite a sua própria sessão via BFF; para a web, preferir cookie HTTP-only. O API gateway aplica CORS allowlist, rate limits, body limits e request IDs. Para tarefas assíncronas, usar uma fila/outbox para e-mail, webhook, moderação, processamento IA e expiração; workers devem ser idempotentes.

### Contrato REST inicial

| Domínio | Endpoints iniciais |
| --- | --- |
| Auth/perfil | `GET/PATCH /v1/me`, `GET /v1/me/entitlements` |
| Currículo | `GET /v1/courses`, `GET /v1/courses/{slug}`, `GET /v1/lessons/{id}`, `POST /v1/lessons/{id}/attempts` |
| Progresso | `GET /v1/me/progress`, `POST /v1/progress/events` (evento permitido, servidor calcula estado) |
| Avaliação/IA | `POST /v1/assessments/diagnostic`, `/reading`, `/pronunciation`; `POST /v1/audio/transcriptions`, `/speech`; `POST /v1/ai/conversations/{id}/messages` |
| Billing | `GET /v1/plans`, `POST /v1/checkout-sessions`, `GET /v1/me/subscriptions`, `POST /v1/webhooks/{provider}` |
| Certificados | `GET /v1/me/certificates`, `POST /v1/certificates/eligibility`, `GET /v1/certificates/verify/{code}` |
| Comunidade | `GET/POST /v1/community/messages`, `POST /v1/community/reports`, `POST /v1/users/{id}/blocks` |
| Admin | `/v1/admin/*` com RBAC, filtros, cursor e auditoria |

Todos os comandos mutáveis usam schema, autorização e chave de idempotência quando houver valor financeiro ou possibilidade de replay. Respostas de lista usam `{ items, nextCursor }`; erros usam `{ type, title, status, detail, traceId }`. Publicar OpenAPI como fonte de verdade e gerar cliente/types para o frontend.

## 10. Plano de migração seguro

1. **Fundação (P0):** rotacionar segredos; desativar pagamento simulado e emissão livre; fechar APIs de IA; criar CI mínimo (`typecheck`, lint, build, testes, migração limpa) e observabilidade básica.
2. **Contrato e fronteira:** criar `packages/contracts`, `/api/v1/health`, autenticação/autorizações reutilizáveis, tratamento de erro, logs e um `api-client` no frontend. Não reescrever telas ainda.
3. **Leituras primeiro:** mover perfil, planos, currículo, dashboard, certificados de leitura e vídeos para API. Introduzir feature flags; comparar respostas antigas/novas e métricas.
4. **Escritas críticas:** migrar checkout/webhook, certificado, progresso, XP/missões, exames e admin. Retirar permissões RLS de escrita direta depois de cada caso de uso estar servido pela API.
5. **IA e comunidade:** transformar TTS/STT/diagnóstico/coach em serviços autenticados com quota; substituir canal direto por endpoint autorizado e, se necessário, gateway realtime.
6. **Desacoplamento final:** remover imports `integrations/supabase/client` e `*.functions.ts` de `apps/web`; separar deploy web/API; eliminar handlers TanStack que já não são necessários.
7. **Operação:** filas, cron de expiração, backups com teste de restore, alertas de falha de webhook/IA, SLOs, auditoria e runbooks.

Compatibilidade: manter endpoints/server functions antigos como adapters temporários que chamam a nova camada; usar versionamento `/v1`, flags por funcionalidade e migrações expand/contract. Não duplicar permanentemente regras: cada domínio deve declarar uma única fonte de verdade e ter data reconciliation antes de desligar o caminho antigo.

Riscos principais: divergência de progresso durante dual-write, quebra de sessão ao trocar storage, duplicação de cobrança por retries e regressão em RLS. Mitigar com comandos idempotentes, backfill validado, tabelas de mapeamento, shadow reads, testes de contrato, canary release e rollback por feature flag.

## 11. Critérios de aceite para a separação

- Nenhum ficheiro do frontend importa `@supabase/supabase-js`, chave service role ou server function de domínio.
- Todas as mutações de negócio passam por `/api/v1`, com schema, autenticação, autorização e logs de auditoria.
- Pagamento, progresso, XP, exames e certificados não podem ser forjados por uma chamada directa do browser ao banco.
- OpenAPI, testes de contrato e testes de autorização cobrem os endpoints críticos.
- Pipeline reproduz banco a partir de migrações + seeds, passa testes e bloqueia segredos versionados.
- Métricas, logs estruturados, traces, alertas, backup e rollback estão documentados e testados.