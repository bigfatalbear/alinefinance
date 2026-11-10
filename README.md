# ALINEFINANCE

PWA de controle financeiro pessoal com interface intuitiva, acompanhamento de gastos, orçamento, metas, relatórios e dicas financeiras personalizadas. Os dados ficam no **Supabase** e o app é publicado no **GitHub Pages**.

> **App online:** <https://bigfatalbear.github.io/alinefinance/>

## Funcionalidades

- Tela inicial de apresentação e onboarding para conhecer o usuário (nome, renda, objetivo, perfil de risco e desafio)
- Login multiusuário por e-mail e senha (Supabase Auth)
- Receitas e despesas com categorias, descrição e data
- Orçamento mensal por categoria com alertas de limite
- Metas de economia com progresso e depósitos
- Relatórios com gráficos (despesas por categoria, receitas x despesas nos últimos 6 meses)
- Dicas financeiras personalizadas de acordo com o perfil e os dados do mês
- PWA instalável e com funcionamento offline para a interface

## Stack

- HTML, CSS e JavaScript puros (sem build)
- [Supabase JS](https://supabase.com/docs/reference/javascript) (vendorizado em `vendor/supabase.js`)
- [Chart.js](https://www.chartjs.org/) (vendorizado em `vendor/chart.umd.js`)
- GitHub Pages para hospedagem

## Estrutura

```
alinefinance/
├─ index.html
├─ manifest.webmanifest
├─ sw.js
├─ css/styles.css
├─ js/config.js        # credenciais do Supabase
├─ js/app.js           # lógica da aplicação
├─ vendor/             # bibliotecas locais (offline)
├─ icons/
└─ supabase/
   └─ migrations/0001_init.sql
```

## Configuração do Supabase

1. Crie um projeto em <https://supabase.com/dashboard>.
2. No **SQL Editor**, execute o conteúdo de `supabase/migrations/0001_init.sql`.
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
4. Edite `js/config.js`:

```js
window.ALINE_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA-ANON-KEY"
};
```

5. Em **Authentication → Providers → Email**, ajuste a confirmação de e-mail conforme a sua preferência. Neste projeto a confirmação automática está **ativada** (`mailer_autoconfirm`) para facilitar o primeiro acesso; reative o **Confirm email** se quiser exigir confirmação.
6. Em **Authentication → URL Configuration**, adicione a URL do GitHub Pages em **Site URL** e **Redirect URLs** (ex.: `https://SEU-USUARIO.github.io/alinefinance/`).

> A `anon key` é pública por design. A proteção dos dados é feita pelas políticas de RLS incluídas na migration.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra <http://localhost:4173>.

## Deploy no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` publica o site ao enviar alterações para `main` ou ao iniciá-lo manualmente em **Actions → Deploy static site to GitHub Pages → Run workflow**.

Em **Settings → Pages**, selecione **GitHub Actions** como origem de publicação. Depois que o workflow terminar, acesse `https://SEU-USUARIO.github.io/alinefinance/`.

O arquivo `.nojekyll` já está incluído para servir os arquivos corretamente.

## Segurança

- RLS habilitado em todas as tabelas: cada usuário só acessa os próprios registros.
- Nunca use a `service_role key` no front-end.
- A `anon key` pode ficar no repositório, pois é pública e limitada pelas políticas RLS.
