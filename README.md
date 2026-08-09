# JK Barbearia — Versão Real com Supabase

Esta versão foi preparada para uso real na internet.

## O que mudou
- Agendamentos ficam salvos no **Supabase**
- Cliente agenda no celular e o proprietário vê no painel em outro dispositivo
- Horários ocupados são sincronizados
- Banco impede dois agendamentos ativos no mesmo horário
- Login do proprietário usa **Supabase Auth**
- Serviços, preços e fotos podem ser alterados pelo painel
- Configuração padrão: **08:00 às 19:00**
- Imagens de serviços podem ser enviadas para o Supabase Storage
- Pronto para **GitHub Pages**

## 1. Criar projeto Supabase
1. Entre em https://supabase.com
2. Crie uma conta/projeto
3. Escolha um nome, por exemplo `jk-barbearia`
4. Defina uma senha forte para o banco

## 2. Criar banco
No Supabase:
1. Abra `SQL Editor`
2. Clique em `New query`
3. Abra o arquivo `supabase/schema.sql` deste projeto
4. Copie tudo
5. Cole no SQL Editor e clique em `Run`

## 3. Criar usuário administrador
No Supabase:
1. Authentication
2. Users
3. Add user
4. Crie o e-mail e a senha do proprietário

Esse e-mail/senha será usado em `admin.html`.

## 4. Configurar o site
No Supabase:
1. Project Settings
2. API
3. Copie `Project URL`
4. Copie a chave `anon public`

Depois abra:
`js/config.js`

e substitua:
- `COLE_SUA_SUPABASE_URL_AQUI`
- `COLE_SUA_SUPABASE_ANON_KEY_AQUI`

A chave `anon` pode ficar no site. **Nunca coloque a service_role key no front-end.**

## 5. Rodar localmente
Abra a pasta no VS Code e use Live Server.

## 6. Publicar no GitHub Pages
O projeto já possui:
`.github/workflows/pages.yml`

Depois de enviar para um repositório público na branch `main`:
1. GitHub > Settings
2. Pages
3. Source: GitHub Actions

## Observação importante
A segurança do painel depende das políticas RLS e do Supabase Auth configuradas pelo `schema.sql`.

## Status desta versão
- Supabase conectado: **SIM**
- Banco criado: **SIM**
- Horário padrão: **08:00 às 19:00**
- Serviços iniciais cadastrados: **SIM**
- Agenda compartilhada entre dispositivos: **SIM**
- Repositório GitHub esperado: `Ileansilva/jk-barbearia`

### Único passo ainda necessário no GitHub
A integração do ChatGPT precisa receber permissão de escrita para o repositório `Ileansilva/jk-barbearia`.
