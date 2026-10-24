# Voka na VPS TOWER: guia de instalação (kit v2, para revisão)

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

Recursos exclusivos do Voka:
- projeto Compose `voka`;
- rede `voka_net`;
- volumes `voka_pgdata` e `voka_uploads`;
- banco e usuário `voka`;
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
| `uninstall.sh` | Remove os contentores e mantém os dados | Sim, com confirmação |
| `lib.sh`, `backup-lib.sh`, `backup-loop.sh` | Funções usadas pelos scripts | — |

`install`, `update`, `rollback` e `restore` usam uma trava (`deploy/.voka.lock`): dois deles nunca rodam ao mesmo tempo.

## Passo a passo

### 0. Código na VPS (sem CRLF)
Os scripts precisam de quebras de linha Unix (LF). O repositório tem um `.gitattributes` que garante isso. Use uma destas formas:
- `git clone https://github.com/dravtt/Meu-Discord.git /opt/voka` (repositório privado: token só de leitura);
- ou um ZIP feito com `git archive` (ele respeita o `.gitattributes`), copiado por `scp`.

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
- `NEXO_ADMIN_EMAILS`: **obrigatório**. É o e-mail de quem administra o Voka. Só vale depois de essa conta confirmar o e-mail com o código. Em produção **não existe** "a primeira conta vira admin";
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
4. constrói a imagem e liga os contentores;
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
- o último backup válido e com menos de 26 h, e as permissões 700/600;
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
3. constrói a nova versão e reinicia **só** o `voka-app`;
4. espera ficar saudável e roda os testes. Se falhar, termina com erro e mostra o comando de rollback.

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
- **Copie `deploy/backups` para fora da VPS** com a rotina de backup externo da TOWER.
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

## Remover
```bash
sudo bash deploy/uninstall.sh      # remove contentores e rede; volumes e backups ficam
docker volume rm voka_pgdata voka_uploads   # SÓ se quiser apagar os dados (irreversível)
```
Depois, remova o `voka.conf` do nginx (`rm` em `sites-enabled`, `nginx -t`, `reload`) e as regras de firewall das portas 7881 e 7882.

## Acompanhamento
| Para… | Comando (na pasta `deploy`) |
|---|---|
| Estado | `sudo docker compose ps` |
| Consumo | `sudo docker stats voka-app voka-postgres voka-livekit voka-backup` |
| Logs | `sudo docker compose logs --tail 100 app` (ou `livekit`, `backup`) |

O consumo em repouso foi medido no teste (ver `TESTES.md`). O consumo com chamadas reais ainda **precisa ser medido na TOWER**. Se o Voka crescer, aumente os `limits` no `docker-compose.yml` ou leve o `voka-livekit` para uma VPS separada.
