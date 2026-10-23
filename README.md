# Voka

Voka é um app de comunidades e chat em tempo real, no estilo do Discord, escrito do zero.
Tem servidor (API), aplicativo web e aplicativo desktop para Windows, macOS e Linux.

Nenhum código, imagem, som ou marca do Discord foi usado. A arquitetura do app desktop
foi inspirada numa análise estática do cliente oficial feita com o [REA](https://github.com/morluto/rea):
uma "casca" que mostra a tela de carregamento e procura atualizações, e um "núcleo" que abre a janela,
a bandeja do sistema e uma ponte nativa segura para o site.

## Funcionalidades

- **Contas**: cadastro, login, perfil (nome, avatar, "sobre mim", status personalizado), troca de senha.
- **Status**: disponível, ausente, não perturbe e invisível, atualizados em tempo real.
- **Amigos**: pedidos de amizade, aceitar ou recusar, remover, bloquear.
- **Mensagens diretas** 1:1 e **grupos** de até 10 pessoas.
- **Servidores**: criar, ícone, renomear, transferir posse, excluir, sair.
- **Convites** com link, validade e limite de usos; links `#/convite/CÓDIGO` e `nexo://convite/CÓDIGO`.
- **Canais** de texto e de voz, **categorias**, canais privados e permissões por canal.
  Canais sem permissões próprias seguem as da categoria.
- **Cargos** com cor, ordem e 20 permissões (ver canais, enviar, gerenciar mensagens, expulsar, banir, etc.),
  hierarquia de cargos e cargo `@everyone`.
- **Moderação**: expulsar, banir e desbanir, apelidos.
- **Mensagens** em tempo real: editar, apagar, responder, menções `@pessoa` e `@everyone`,
  reações com emoji, fixar, anexos (até 25 MB, com prévia de imagem, vídeo e áudio),
  formatação (**negrito**, *itálico*, `código`, blocos de código, ~~riscado~~, ||spoiler||, links).
- **Tópicos** (threads) a partir de uma mensagem.
- **Busca** de mensagens no servidor.
- **Não lidas e menções** por canal, com contador no ícone do servidor e na barra de tarefas.
- **Indicador de "digitando…"**.
- **Voz e vídeo** em canais de voz e chamadas em DMs, com câmera e **compartilhamento de tela** (via LiveKit).
- **Notificações** do sistema para DMs e menções (o modo "não perturbe" silencia).
- **App desktop**: tela de carregamento, atualização automática, bandeja do sistema, minimizar para a bandeja,
  iniciar com o sistema, lembra tamanho e posição da janela, uma instância só, links externos no navegador.

## Estrutura

```
server/   API (Node.js, Express, Socket.IO, PostgreSQL) + testes
web/      Interface (React + Vite)
desktop/  App desktop (Electron)
e2e/      Testes de ponta a ponta com 2 usuários no navegador e teste do app desktop
```

## Rodar no seu PC (Windows)

Você precisa de:

- [Node.js](https://nodejs.org) 22 ou mais novo
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (para o banco de dados e o servidor de voz)

No terminal (PowerShell), dentro da pasta do projeto:

```powershell
# 1. Banco de dados (PostgreSQL) e servidor de voz (LiveKit)
docker compose up -d

# 2. Dependências
npm install

# 3. Configuração do servidor
copy server\.env.example server\.env

# 4. Compilar e iniciar (o servidor também entrega o app web)
npm run build
npm start
```

Abra http://localhost:3001 no navegador. Para testar com outra pessoa, abra uma janela anônima e crie outra conta.

### Modo de desenvolvimento

Em dois terminais:

```powershell
npm run dev:server   # API em http://localhost:3001
npm run dev:web      # interface em http://localhost:5173 (recarrega ao salvar)
```

### App desktop

```powershell
npm run desktop                      # abre o app apontando para http://localhost:3001
$env:NEXO_URL="https://seu-servidor"; npm run desktop   # outro servidor
npm run dist:win                     # gera o instalador em desktop\out
```

O app guarda as configurações em `%APPDATA%\Voka\settings.json` (endereço do servidor, bandeja, etc.).
Para a atualização automática, publique os arquivos de `desktop\out` num endereço e coloque esse endereço
em `build.publish.url` no `desktop/package.json`.

## Colocar online para outras pessoas

1. Hospede o servidor (qualquer VPS com Node.js e PostgreSQL) e defina no `server/.env`:
   `DATABASE_URL`, um `JWT_SECRET` longo e aleatório, e `WEB_ORIGIN` com o endereço público.
2. Use HTTPS (por exemplo com Caddy ou Nginx na frente). Câmera, microfone e notificações exigem HTTPS fora do `localhost`.
3. Voz e vídeo: rode o LiveKit com chaves próprias (não use o modo `--dev` em produção)
   ou use o LiveKit Cloud, e preencha `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`.
4. Os anexos ficam em `UPLOAD_DIR`. Faça backup dessa pasta e do banco.

## Testes

```powershell
npm test                    # 24 testes da API (precisa do PostgreSQL rodando, banco nexo_test)
```

Para criar o banco de testes: `docker compose exec postgres createdb -U nexo nexo_test`.

Os testes de ponta a ponta em `e2e/` usam Playwright: `browser.mjs` simula duas pessoas usando o app
(convite, menções, reações, cargos, tópicos, DMs, anexos, voz com câmera e presença) e `desktop.mjs`
abre o app Electron e confere a janela, a ponte nativa e a bandeja.
