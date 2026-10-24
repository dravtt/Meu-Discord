# Colocar o Voka no ar numa VPS

Este guia instala o Voka numa VPS Linux (testado em Ubuntu 22.04) com Docker. O kit sobe estes serviços:

| Serviço | O que faz | Limite |
|---|---|---|
| `app` | Site + API do Voka | 2 vCPU, 2 GB |
| `postgres` | Banco de dados | 1 vCPU, 1 GB |
| `livekit` | Chamadas de voz e vídeo | 1,5 vCPU, 1 GB |
| `caddy` | HTTPS automático (Let's Encrypt) | 0,5 vCPU, 256 MB |
| `backup` | Cópia diária do banco em `deploy/backups` (guarda 14 dias) | 0,5 vCPU, 256 MB |

Os serviços ficam isolados no Docker e voltam a ligar sozinhos quando a VPS reinicia.

## 1. Antes de começar

**Domínio.** No painel do domínio, crie um registro **A** apontando para o IP público da VPS:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` (ou um subdomínio, ex.: `app`) | IP da VPS |

**Firewall.** Libere estas portas de **entrada**, tanto no painel da nuvem (HostGator/Oracle: "Security List" ou "Firewall") quanto no `ufw`, se ele estiver ativo:

| Porta | Protocolo | Para quê |
|---|---|---|
| 80 | TCP | Certificado HTTPS e redirecionamento |
| 443 | TCP e UDP | Site (HTTPS e HTTP/3) |
| 7881 | TCP | Chamadas (quando o UDP está bloqueado) |
| 7882 | UDP | Chamadas (caminho principal, melhor qualidade) |

Com `ufw` ativo:

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp
```

## 2. Instalar

```bash
# baixar o código (repositório privado: use um token do GitHub ou copie o projeto por scp)
git clone https://github.com/dravtt/Meu-Discord.git voka
cd voka
sudo bash deploy/install.sh
```

O script faz o seguinte:
1. Instala o Docker, se ainda não tiver.
2. Pergunta o domínio e cria o arquivo `deploy/.env` com senhas aleatórias (banco, login e chaves de voz).
3. Descobre o IP público para as chamadas. Se errar, coloque `VOKA_PUBLIC_IP=x.x.x.x` no `deploy/.env` e rode o script de novo.
4. Cria 4 GB de swap, se a VPS não tiver nenhuma. Para pular essa etapa, rode `VOKA_NO_SWAP=1 sudo -E bash deploy/install.sh`.
5. Constrói e liga tudo. Na primeira vez leva alguns minutos.

No fim, abra `https://SEU-DOMINIO`. **A primeira conta criada vira administradora.**

## 3. E-mails de verificação

Edite `deploy/.env` (`sudo nano deploy/.env`), tire o `#` das linhas `SMTP_URL` e `MAIL_FROM`, preencha-as e rode:

```bash
sudo bash deploy/install.sh
```

Enquanto não houver SMTP, os códigos aparecem em `sudo docker compose -f deploy/docker-compose.yml logs app`.

## 4. Atualizar para uma versão nova

```bash
cd voka
sudo bash deploy/update.sh
```

O script faz `git pull` e reconstrói o Voka. O banco, os uploads e as configurações são mantidos.

## 5. Dia a dia

Rode estes comandos dentro da pasta `voka/deploy`:

| Para… | Comando |
|---|---|
| Ver se está tudo ligado | `sudo docker compose ps` |
| Ver consumo de CPU, RAM e rede | `sudo docker stats` |
| Ver erros do Voka | `sudo docker compose logs --tail 100 app` |
| Ver erros das chamadas | `sudo docker compose logs --tail 100 livekit` |
| Reiniciar tudo | `sudo docker compose restart` |
| Desligar | `sudo docker compose down` (os dados continuam salvos) |

**Backups:** ficam em `deploy/backups/voka-AAAA-MM-DD.sql.gz`. Copie-os de vez em quando para **fora** da VPS. Para restaurar um backup (isso apaga os dados atuais):

```bash
sudo docker compose stop app
gunzip -c backups/voka-AAAA-MM-DD.sql.gz | sudo docker compose exec -T postgres sh -c 'dropdb -U voka voka && createdb -U voka voka && psql -q -U voka voka'
sudo docker compose start app
```

As imagens e os arquivos enviados ficam no volume Docker `voka_uploads`.

## Portas 80/443 ocupadas

Se a VPS já tem um servidor web (nginx, Apache, Traefik…) nas portas 80/443, o `install.sh` percebe e **não** liga o Caddy. Nesse caso, o servidor web que já existe deve repassar o domínio do Voka para:

- `/rtc`, `/rtc/*` e `/twirp/*` → `http://127.0.0.1:7880` (voz, com WebSocket)
- todo o resto → `http://127.0.0.1:3001` (site e API, com WebSocket)

Exemplo para nginx:

```nginx
server {
    server_name vokaapp.com.br;
    client_max_body_size 90m;
    location ~ ^/(rtc|twirp)(/|$) {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
    # + certificado HTTPS (ex.: certbot --nginx)
}
```

Se as portas 3001 ou 7880 já estiverem em uso, mude `VOKA_APP_PORT` e `VOKA_LIVEKIT_PORT` no `deploy/.env`.

## Capacidade e rede

Com os limites acima, o kit atende bem um grupo inicial (dezenas de pessoas em chamada). Acompanhe o uso com `docker stats` e pelo tráfego de rede no painel da nuvem. Para crescer, aumente os `limits` em `deploy/docker-compose.yml` ou leve o `livekit` para uma VPS só dele.
