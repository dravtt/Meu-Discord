# Voka na VPS TOWER: guia de instalação (kit v3, para revisão)

Este kit instala o Voka **ao lado** do que já roda na TOWER, sem substituir nem interromper nada.
- Nenhum script altera a máquina sem pedir confirmação (é preciso digitar `SIM`).
- Swap, firewall, nginx e certificados **nunca** são alterados pelos scripts. Esses passos ficam com o administrador e estão descritos abaixo, com o comando para desfazer cada um.
- Os resultados dos testes do kit estão em [`TESTES.md`](TESTES.md).

## O que é instalado

| Contentor | Função | Rede / portas | Limite |
|---|---|---|---|
| `voka-app` | Site, API e chat em tempo real | `127.0.0.1:3001` | 0,8 vCPU · 1,5 GB |
| `voka-postgres` | Banco de dados exclusivo do Voka | **sem porta publicada** | 0,5 vCPU · 1 GB |
| `voka-livekit` | Chamadas de voz e vídeo | `127.0.0.1:7880` (sinal) · **TCP 7881** e **UDP 7882** públicas (mídia) | 0,6 vCPU · 1 GB |
| `voka-backup` | Backup diário verificado do banco | sem porta | 0,1 vCPU · 256 MB |
| **Total** | | | **2 vCPU · 3,75 GB** |

**Build da imagem.** O build (`npm ci`, `vite build`) tem um teto próprio: **1 vCPU e 2 GB de RAM, sem swap** (`VOKA_BUILD_CPUS` e `VOKA_BUILD_MEMORY` no `.env`). O pico medido foi de cerca de 0,4 GB. Ele só existe durante o `install.sh` e o `update.sh`. Nessa janela, o Voka inteiro usa no máximo **3 vCPU e 5,75 GB** (os contentores + o build). Fora dela, usa no máximo 2 vCPU e 3,75 GB. Faça as atualizações num horário de pouco uso.

Como o teto é aplicado:
- **sem o plugin buildx** (o caso da TOWER hoje): o builder clássico do Docker roda cada etapa do build num contentor temporário com `--cpu-quota` e `--memory`. **Nada precisa ser instalado** no Docker da TOWER;
- **com o plugin buildx**: o build roda num contentor BuildKit próprio, `voka-builder`, com o mesmo teto, parado logo depois do build.

`VOKA_BUILD_MODE=auto` (padrão) escolhe sozinho; `classic` ou `buildx` força um dos dois. O builder clássico aparece como "deprecated" nas versões novas do Docker, mas continua funcionando.

Recursos exclusivos do Voka:
- projeto Compose `voka`;
- rede `voka_net`;
- volumes `voka_pgdata` e `voka_uploads`;
- banco e usuário `voka`;
- só com buildx: builder `voka-builder` (contentor `buildx_buildkit_voka-builder0`, só durante o build);
- pasta do projeto (sugestão: `/opt/voka`).

Os logs são rotacionados (5 arquivos de 20 MB por contentor).

## Arquivos

| Arquivo | Para quê | Altera a VPS? |
|---|---|---|
| `docker-compose.yml` | Definição dos 4 contentores | — |
| `.env.example` | Modelo da configuração, sem segredos | — |
| `livekit.yaml.template` | Modelo da configuração da voz | — |
| `proxy-examples/nginx-fase1-http.conf` | nginx fase 1: só HTTP, para emitir o certificado | — |
| `proxy-examples/nginx-fase2-https.conf` | nginx fase 2: HTTPS e encaminhamento | — |
| `check-kit.sh` | Confere o próprio kit: CRLF, `bash -n`, `docker compose config` | **Não** |
| `preflight.sh` | Verificação antes de instalar | **Não** (só lê) |
| `install.sh` | Gera o `.env` e depois instala | Sim, com confirmação |
| `smoke-test.sh` | Testes depois de instalar ou atualizar | **Não** (só lê) |
| `rtc-check.sh` | Testes das chamadas (portas, IP, /rtc, token de teste) | **Não** (só lê) |
| `update.sh` | Atualiza (backup + versão anterior registada) | Sim, com confirmação |
| `rollback.sh` | Volta à versão anterior exata | Sim, com confirmação |
| `restore.sh` | Restaura um backup do banco | Sim, com confirmação |
| `backup-offsite.sh` | Copia os backups e os uploads para outra máquina | Só envia para o destino; agendado pelo administrador |
| `uninstall.sh` | Remove os contentores e mantém os dados | Sim, com confirmação |
| `lib.sh`, `backup-lib.sh`, `backup-loop.sh` | Funções usadas pelos scripts | — |

`install`, `update`, `rollback` e `restore` usam uma trava (`deploy/.voka.lock`): dois deles nunca rodam ao mesmo tempo.

## Passo a passo

### 0. Código na VPS (sem CRLF)
O `Dockerfile` precisa do **projeto inteiro** (`server`, `web`, `desktop`, os `package.json` e o `package-lock.json`), e não só da pasta `deploy`. Os scripts precisam de quebras de linha Unix (LF). O repositório tem um `.gitattributes` que garante isso. Use uma destas formas:
- `git clone https://github.com/dravtt/Meu-Discord.git /opt/voka` (repositório privado: token só de leitura);
- ou o ZIP completo `voka-completo.zip`, feito com `git archive` (ele respeita o `.gitattributes` e só leva arquivos do repositório, nunca `.env`), copiado por `scp` e aberto com `unzip voka-completo.zip -d /opt/voka`.

Não copie a pasta do Windows diretamente, e **nunca** envie arquivos `.env`. O `deploy/.env` é criado na própria VPS.

Depois confira o kit (não altera nada):
```bash
cd /opt/voka
bash deploy/check-kit.sh
```

### 1. Verificar, sem alterar nada
```bash
sudo bash deploy/preflight.sh vokaapp.com.br
```
O preflight **só lê**. No início, ele lista os comandos que usa. Ele mostra:
- se o kit está sem CRLF e passa no `bash -n`;
- Docker e Compose;
- contentores, volumes ou rede `voka*` que já existam;
- CPU, RAM, disco e swap;
- se as portas 3001, 7880, 7881/tcp e 7882/udp estão livres;
- quem usa as portas 80/443 (o kit supõe o nginx instalado na VPS, fora do Docker);
- regras do `ufw` e do `iptables`;
- IP público, DNS do domínio e certificado HTTPS.

O firewall do **provedor** (Security List da HostGator/Oracle) não pode ser visto de dentro da VPS. Confira-o no painel.

### 2. Gerar a configuração
```bash
sudo bash deploy/install.sh
```
Na primeira execução, o script **só cria o `deploy/.env`** (permissão 600), com senhas aleatórias, e para. Revise o arquivo:
- `VOKA_DOMAIN` e `VOKA_PUBLIC_IP` (o IP público que as chamadas anunciam);
- `NEXO_ADMIN_EMAILS`: **obrigatório**. É o e-mail de quem administra o Voka. Só vale depois de essa conta confirmar o e-mail com o código. É a **única** forma de ser admin em produção:
  - o servidor ignora `NEXO_ADMINS` (por nome de usuário) quando `NODE_ENV=production`;
  - não existe "a primeira conta vira admin";
  - o `install.sh` recusa instalar se faltar `NEXO_ADMIN_EMAILS`, se algum e-mail for inválido ou se `NEXO_ADMINS` ou `NEXO_FIRST_USER_ADMIN` estiverem no `.env`; o `smoke-test.sh` confere o mesmo dentro do contentor, sem mostrar os valores;
- as portas, se alguma estiver em uso;
- `SMTP_URL` e `MAIL_FROM`, para os e-mails de verificação.

Os scripts nunca mostram as senhas do `.env` na tela nem nos logs.

### 3. Instalar
```bash
sudo bash deploy/install.sh
```
O script faz o seguinte:
1. roda o preflight de novo e para se houver erro;
2. mostra o plano e pede `SIM`;
3. gera o `livekit.yaml` (permissão 600);
4. constrói a imagem com o teto do build e liga os contentores;
5. espera **todos** ficarem saudáveis;
6. roda os testes locais. Se algum falhar, o script termina com erro.

### 4. nginx, fase 1: certificado
O arquivo é **novo** e só para o domínio do Voka. Os vhosts existentes não são tocados.
```bash
sudo mkdir -p /var/www/voka-acme
sudo cp deploy/proxy-examples/nginx-fase1-http.conf /etc/nginx/sites-available/voka.conf   # troque o domínio dentro dele
sudo ln -s /etc/nginx/sites-available/voka.conf /etc/nginx/sites-enabled/voka.conf
sudo nginx -t && sudo systemctl reload nginx        # reload só se o -t disser "successful"
sudo certbot certonly --webroot -w /var/www/voka-acme -d vokaapp.com.br
```
Para desfazer: `sudo rm /etc/nginx/sites-enabled/voka.conf && sudo nginx -t && sudo systemctl reload nginx`.

### 5. nginx, fase 2: HTTPS
Só depois de o certbot criar `/etc/letsencrypt/live/DOMINIO/fullchain.pem` e `privkey.pem`:
```bash
sudo cp /etc/nginx/sites-available/voka.conf /etc/nginx/sites-available/voka.conf.fase1
sudo cp deploy/proxy-examples/nginx-fase2-https.conf /etc/nginx/sites-available/voka.conf  # troque o domínio
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run --deploy-hook "systemctl reload nginx"
```
A fase 2 faz o seguinte:
- 80 redireciona para 443;
- `/rtc`, `/rtc/*` e `/twirp/*` vão para a voz em `127.0.0.1:7880`, com WebSocket;
- todo o resto vai para `127.0.0.1:3001`, com WebSocket, `X-Forwarded-*` e uploads de até 90 MB.

O endereço das chamadas fica `LIVEKIT_URL=wss://DOMINIO` (o `docker-compose.yml` monta isso sozinho).

Para voltar à fase 1: `sudo cp /etc/nginx/sites-available/voka.conf.fase1 /etc/nginx/sites-available/voka.conf && sudo nginx -t && sudo systemctl reload nginx`.

### 6. Firewall (administrador)
Libere a **entrada TCP 7881 e UDP 7882**:
- no painel do provedor;
- no servidor, se houver regras próprias. Com `ufw`, por exemplo: `ufw allow 7881/tcp` e `ufw allow 7882/udp`.

As portas 3001 e 7880 ficam só em `127.0.0.1` e **não** devem ser abertas.

**Por que só essas duas portas.** A voz manda a mídia por **UDP 7882** (uma porta só, para todas as chamadas). Quando a rede do usuário bloqueia UDP, ela usa **TCP 7881**. O `node_ip` é o IP público da VPS. Se a VPS tem IP público direto (sem NAT de 1:1), isso basta. Se tiver NAT, as duas portas precisam do mesmo número por fora e por dentro.

**TURN/TLS na 443 não está ativo.** Ele só é preciso para usuários em redes que bloqueiam tudo menos a 443 (algumas empresas e escolas). Pode ser uma fase 2 depois, com um subdomínio próprio (ex.: `turn.vokaapp.com.br`).

### 7. Testar
```bash
bash deploy/smoke-test.sh
bash deploy/rtc-check.sh
```
O `smoke-test.sh` verifica:
- os 4 contentores `running` e `healthy`, sem reinícios;
- o PostgreSQL sem porta publicada e todos só na rede `voka_net`;
- os **limites efetivos** (`docker inspect`), com a soma até 2 vCPU / 4 GB;
- as regras de administrador (acima) e `NODE_ENV=production`;
- o último backup válido e com menos de 26 h, a cópia externa em dia, e as permissões 700/600;
- site e voz em 127.0.0.1;
- `https://DOMINIO/api/health`, `/rtc` (resposta 401), WebSocket do chat (101) e validade do certificado.

O `rtc-check.sh` confere as portas publicadas, o `node_ip` e o `/rtc`. Também gera um token de 10 minutos para o teste oficial em https://livekit.io/connection-test.

Por fim, faça os testes reais:
- de **outro computador**: `nc -vz IP 7881` (o UDP não dá para testar com `nc`; o teste do livekit.io e a chamada real cobrem o UDP);
- uma **chamada de voz e vídeo** entre duas pessoas em redes diferentes (Wi-Fi e 4G).

## Swap (proposta, não é aplicada pelos scripts)
A TOWER não tem swap. Recomendação: criar **4 GB**, só se o administrador aprovar.
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
Para desfazer: `sudo swapoff /swapfile && sudo rm /swapfile` e apague a linha correspondente em `/etc/fstab`.

## Atualizar
Coloque o código novo na pasta (por exemplo, `git pull`) e rode:
```bash
sudo bash deploy/update.sh
```
O script faz o seguinte:
1. faz um backup **verificado** do banco (`backups/voka-antes-update-…sql.gz`);
2. regista em `deploy/.ultima-atualizacao` o **ID exato** da imagem em uso e o nome do backup. O registo não depende de tags;
3. constrói a nova versão com o teto do build e reinicia **só** o `voka-app`;
4. espera ficar saudável e roda os testes. Se falhar, termina com erro e mostra o comando de rollback.

## Atualizar de longe (usuário `voka`, só com os scripts do Voka)
Para atualizar sem sentar no servidor, o administrador cria **uma vez** um usuário `voka` sem senha, entra só com chave SSH, e `sudo` limitado aos scripts do Voka. Esse usuário não é administrador geral da VPS.
```bash
sudo adduser --disabled-password --gecos "" voka
sudo install -d -m 700 -o voka -g voka /home/voka/.ssh
echo 'COLE_AQUI_A_CHAVE_PUBLICA' | sudo tee /home/voka/.ssh/authorized_keys
sudo chown voka:voka /home/voka/.ssh/authorized_keys && sudo chmod 600 /home/voka/.ssh/authorized_keys
sudo tee /etc/sudoers.d/voka >/dev/null <<'S'
voka ALL=(root) NOPASSWD: /usr/bin/bash /opt/voka/deploy/atualizar.sh, /usr/bin/bash /opt/voka/deploy/rollback.sh, /usr/bin/bash /opt/voka/deploy/rollback.sh --manter-banco, /usr/bin/bash /opt/voka/deploy/smoke-test.sh
S
sudo chmod 440 /etc/sudoers.d/voka && sudo visudo -cf /etc/sudoers.d/voka
```
Depois, de outro computador: `ssh -t voka@IP "sudo bash /opt/voka/deploy/atualizar.sh"`. Para desfazer o acesso: `sudo deluser --remove-home voka && sudo rm /etc/sudoers.d/voka`.
Atenção: o `atualizar.sh` roda como root o código que estiver no GitHub. Quem controla o repositório controla o que roda no servidor, então proteja a conta do GitHub (senha forte e verificação em duas etapas).

## Rollback
```bash
sudo bash deploy/rollback.sh                  # programa anterior + banco do backup feito antes da atualização
sudo bash deploy/rollback.sh --manter-banco   # só o programa (quando a atualização não mudou o banco)
```
O rollback volta para a imagem exata registada e confere se o contentor ficou nela. Por padrão, também restaura o banco, porque a versão nova pode ter aplicado migrations. Tudo o que foi gravado depois da atualização se perde, mas o estado atual fica guardado antes, num backup e no banco `voka_antigo_<data>`.

## Backups e restauração
- O backup é automático, todos os dias às `VOKA_BACKUP_TIME` (padrão 03:30, fuso `TZ`), e roda uma vez logo ao ligar.
- O arquivo é gravado com outro nome, conferido (gzip íntegro e dump completo) e só então renomeado para `deploy/backups/voka-AAAA-MM-DD.sql.gz`. Backups antigos (14 dias) só são apagados depois de um backup bem-sucedido.
- Se o backup falhar, o arquivo `backups/FALHOU-ultimo-backup.txt` é criado. Nesse caso, o `voka-backup` fica `unhealthy` e o `smoke-test.sh` acusa erro.
- A cópia para fora da VPS é feita pelo `backup-offsite.sh` (seção abaixo).
- Os uploads ficam no volume `voka_uploads`. Para copiá-lo:
  `docker run --rm -v voka_uploads:/u -v "$PWD":/out alpine tar czf /out/voka-uploads.tgz -C /u .`

Para restaurar:
```bash
sudo bash deploy/restore.sh backups/voka-AAAA-MM-DD.sql.gz
```
O restore faz o seguinte:
1. confere o backup; se estiver inválido, para sem mudar nada;
2. guarda o estado atual (`backups/voka-antes-restore-…`);
3. carrega o backup num banco **temporário** (`voka_restaurando`), numa transação única. Se der erro, apaga o temporário, e o banco atual nem foi tocado;
4. só então para o Voka por alguns segundos e troca os nomes. O banco antigo fica guardado como `voka_antigo_<data>`. Se a troca falhar, o banco original volta ao lugar e o Voka é religado.

Apague o `voka_antigo_<data>` quando tiver certeza (o script mostra o comando).

## Cópia externa (proposta para o administrador)
Os backups na própria VPS não protegem contra a perda da VPS. O `backup-offsite.sh` envia `deploy/backups/` para **outra máquina**, por `rsync` sobre SSH. Isso inclui o banco e um pacote diário dos uploads (`backups/uploads/voka-uploads-AAAA-MM-DD.tgz`, 7 dias guardados aqui).

O que o script faz:
1. confere o último backup do banco (íntegro e com menos de 26 h);
2. empacota os uploads e confere o pacote;
3. envia **sem `--delete`**: apagar aqui nunca apaga no destino;
4. confere o destino com `rsync --checksum --dry-run`. Se houver diferença, o resultado é falha;
5. marca o resultado: `backups/.copia-externa-ok` ou `backups/FALHOU-copia-externa.txt`. O `smoke-test.sh` acusa erro se falhou ou se tem mais de 26 h.

O script tem trava própria, não mostra senhas e usa `BatchMode` e `StrictHostKeyChecking`: ele nunca pergunta nada nem aceita uma máquina desconhecida.

**Destino sugerido:** a KHUMOTONE, que é outra VPS. O ideal a médio prazo é outro provedor ou outro datacenter.

**Configuração** (feita uma vez, pelo administrador):
```bash
# na TOWER: chave só para esta cópia
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/voka_offsite
# no DESTINO: conta própria, sem sudo, só com a pasta dos backups
sudo adduser --disabled-password --gecos '' voka-backup
sudo install -d -o voka-backup -m 700 /srv/voka-backups /home/voka-backup/.ssh
# cole a chave pública (/root/.ssh/voka_offsite.pub da TOWER) em /home/voka-backup/.ssh/authorized_keys (dono voka-backup, permissão 600)
# na TOWER: aceitar a chave do destino UMA vez, conferindo a impressão digital
sudo ssh -i /root/.ssh/voka_offsite voka-backup@DESTINO true
```
No `deploy/.env`, preencha `VOKA_OFFSITE_DEST=voka-backup@DESTINO:/srv/voka-backups/` (e `VOKA_OFFSITE_SSH_PORT`, se não for a 22). Teste à mão com `sudo bash deploy/backup-offsite.sh`.

**Agendamento** (só depois de aprovado). Crie `/etc/cron.d/voka-offsite`, uma hora depois do backup diário:
```
30 4 * * * root bash /opt/voka/deploy/backup-offsite.sh >> /var/log/voka-offsite.log 2>&1
```
Para desfazer: `sudo rm /etc/cron.d/voka-offsite`.

**Restaurar a partir do destino:** copie o arquivo de volta (`scp voka-backup@DESTINO:/srv/voka-backups/voka-AAAA-MM-DD.sql.gz deploy/backups/`) e use o `restore.sh`. Os uploads voltam com:
`docker exec -i voka-app tar xzf - -C /data/uploads < deploy/backups/uploads/voka-uploads-AAAA-MM-DD.tgz`

**Retenção no destino:** o destino guarda tudo. Se quiser limitar, acrescente lá um cron, por exemplo `find /srv/voka-backups -name '*.gz' -mtime +60 -delete`.

## Remover
```bash
sudo bash deploy/uninstall.sh      # remove contentores, rede e o builder (cache); volumes e backups ficam
docker volume rm voka_pgdata voka_uploads   # SÓ se quiser apagar os dados (irreversível)
```
Depois, remova o `/etc/cron.d/voka-offsite` (se criado), o `voka.conf` do nginx (`rm` em `sites-enabled`, `nginx -t`, `reload`) e as regras de firewall das portas 7881 e 7882.

## Acompanhamento
| Para… | Comando (na pasta `deploy`) |
|---|---|
| Estado | `sudo docker compose ps` |
| Consumo | `sudo docker stats voka-app voka-postgres voka-livekit voka-backup` |
| Logs | `sudo docker compose logs --tail 100 app` (ou `livekit`, `backup`) |

O consumo em repouso foi medido no teste (ver `TESTES.md`). O consumo com chamadas reais ainda **precisa ser medido na TOWER**. Se o Voka crescer, aumente os `limits` no `docker-compose.yml` ou leve o `voka-livekit` para uma VPS separada.
