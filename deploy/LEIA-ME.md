# Voka na VPS TOWER: guia de instalação (para revisão)

Este kit instala o Voka **ao lado** do que já roda na VPS, sem substituir nem interromper nada. Nenhum script altera a máquina sem pedir confirmação (é preciso digitar `SIM`). Swap, firewall e proxy reverso **nunca** são alterados pelos scripts. Essas mudanças ficam com o administrador e estão descritas abaixo.

## O que é instalado

| Contentor | Função | Rede / portas | Limite |
|---|---|---|---|
| `voka-app` | Site, API e chat em tempo real | `127.0.0.1:3001` | 0,8 vCPU · 1,5 GB |
| `voka-postgres` | Banco de dados exclusivo do Voka | **sem porta publicada** | 0,5 vCPU · 1 GB |
| `voka-livekit` | Chamadas de voz e vídeo | `127.0.0.1:7880` (sinal) · **TCP 7881** e **UDP 7882** públicas (mídia) | 0,6 vCPU · 1 GB |
| `voka-backup` | `pg_dump` diário em `deploy/backups`, guarda 14 dias | sem porta | 0,1 vCPU · 256 MB |
| **Total** | | | **2 vCPU · ~3,8 GB** |

Recursos exclusivos do Voka:
- projeto Compose `voka`
- rede `voka_net`
- volumes `voka_pgdata` e `voka_uploads`
- banco e usuário `voka`

Os logs são rotacionados (5 arquivos de 20 MB por contentor).

> **Portas das chamadas.** O kit usa **uma porta UDP só (7882)** e a TCP 7881, em vez da faixa UDP 50000–50100 citada antes. Isso deixa o firewall mais simples. Os números podem mudar no `deploy/.env`.

## Arquivos

| Arquivo | Para quê | Altera a VPS? |
|---|---|---|
| `docker-compose.yml` | Definição dos 4 contentores | — |
| `.env.example` | Modelo da configuração | — |
| `livekit.yaml.template` | Modelo da configuração da voz | — |
| `proxy-examples/` | Blocos prontos para nginx, Caddy, Traefik e Apache | — |
| `preflight.sh` | Verificação antes de instalar | **Não** (só lê) |
| `install.sh` | Gera o `.env` e depois instala | Sim, com confirmação |
| `smoke-test.sh` | Testes depois de instalar ou atualizar | **Não** (só lê) |
| `update.sh` | Atualiza (backup + versão anterior guardada) | Sim, com confirmação |
| `rollback.sh` | Volta para a versão anterior, opcionalmente com o banco | Sim, com confirmação |
| `restore.sh` | Restaura um backup do banco | Sim, com confirmação |
| `uninstall.sh` | Remove os contentores e mantém os dados | Sim, com confirmação |

## Passo a passo

### 0. Código na VPS
Coloque o projeto numa pasta própria, por exemplo `/opt/voka`:
- com `git clone https://github.com/dravtt/Meu-Discord.git /opt/voka` (se o repositório for privado, use um token de leitura);
- ou copie o projeto por `scp`/`rsync`.

### 1. Verificar, sem alterar nada
```bash
cd /opt/voka
sudo bash deploy/preflight.sh vokaapp.com.br
```
O script mostra:
- Docker e Compose;
- contentores, volumes ou rede `voka*` que já existam;
- CPU, RAM, disco e swap;
- se as portas 3001, 7880, 7881/tcp e 7882/udp estão livres;
- quem usa as portas 80/443, e se o proxy roda em Docker;
- regras do `ufw` e do `iptables`;
- IP público, DNS do domínio e certificado HTTPS.

O firewall do **provedor** (Security List da Oracle/HostGator) não pode ser visto de dentro da VPS. Ele precisa liberar a **entrada TCP 7881 e UDP 7882**.

### 2. Gerar a configuração
```bash
sudo bash deploy/install.sh
```
Na primeira execução, o script **só cria o `deploy/.env`**, com senhas aleatórias e o IP público, e para. Revise o arquivo:
- `VOKA_DOMAIN` e `VOKA_PUBLIC_IP`;
- as portas, se alguma estiver em uso;
- `SMTP_URL` e `MAIL_FROM`, para os e-mails de verificação.

### 3. Instalar
```bash
sudo bash deploy/install.sh
```
O script roda o preflight de novo, mostra o plano, pede `SIM`, constrói a imagem, liga os contentores, espera o `voka-app` ficar saudável e roda os testes locais.

### 4. Proxy reverso existente
Escolha o exemplo em `deploy/proxy-examples/` que corresponde ao proxy da TOWER e acrescente-o à configuração atual, sem mexer nos outros sites. Regras:
- `/rtc`, `/rtc/*` e `/twirp/*` vão para `127.0.0.1:7880`, com WebSocket;
- todo o resto vai para `127.0.0.1:3001`, com WebSocket, `X-Forwarded-For`/`Proto` e uploads de até 90 MB.

Se o **proxy roda num contentor Docker**, ele não alcança o `127.0.0.1` da VPS. Nesse caso, use os destinos `voka-app:3001` e `voka-livekit:7880` e ligue o contentor do proxy à rede do Voka:
```bash
docker network connect voka_net <contentor-do-proxy>
```
Esse comando não reinicia o proxy. Para desfazer: `docker network disconnect voka_net <contentor-do-proxy>`.

Valide e recarregue o proxy pelo procedimento normal dele (`nginx -t && systemctl reload nginx`, `caddy reload`, …). O certificado do domínio é emitido pelo próprio proxy.

### 5. Firewall (administrador)
Libere a entrada **TCP 7881** e **UDP 7882**:
- no painel do provedor;
- no servidor, se houver regras próprias. Com `ufw`, por exemplo: `ufw allow 7881/tcp` e `ufw allow 7882/udp`.

As portas 3001 e 7880 ficam só em `127.0.0.1` e **não** devem ser abertas.

### 6. Testar
```bash
bash deploy/smoke-test.sh
```
O script verifica:
- contentores saudáveis e o PostgreSQL sem porta publicada;
- site e voz em 127.0.0.1;
- `https://DOMINIO/api/health`;
- `/rtc` chegando à voz (resposta 401);
- WebSocket do chat (resposta 101);
- validade do certificado.

Por fim, faça um teste real:
- de **outro computador**: `nc -vz IP 7881`;
- uma **chamada de voz** entre duas pessoas em redes diferentes (Wi-Fi e 4G).

A **primeira conta criada** vira a administradora do Voka.

## Swap (proposta, não é aplicada pelos scripts)
A TOWER não tem swap. Recomendação: criar **4 GB**, se o administrador aprovar.
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
1. faz um backup do banco (`backups/voka-antes-update-…sql.gz`);
2. guarda a imagem atual como `voka-app:previous`;
3. constrói a nova e reinicia **só** o `voka-app`;
4. roda os testes.

Se algo falhar, o script mostra o comando de rollback.

## Rollback
```bash
sudo bash deploy/rollback.sh                                           # só o programa
sudo bash deploy/rollback.sh backups/voka-antes-update-AAAA-MM-DD-HHMMSS.sql.gz   # programa + banco
```
Restaure o banco junto quando a versão nova tiver alterado a estrutura dele (migrations). Na dúvida, restaure.

## Backups e restauração
- O backup é diário e automático, em `deploy/backups/voka-AAAA-MM-DD.sql.gz`, com 14 dias guardados. **Copie esses arquivos para fora da VPS** com a rotina de backup externo da TOWER.
- Os uploads (imagens e arquivos) ficam no volume `voka_uploads`. Para copiá-lo:
  `docker run --rm -v voka_uploads:/u -v "$PWD":/out alpine tar czf /out/voka-uploads.tgz -C /u .`
- Para restaurar o banco a partir de um backup:
  ```bash
  sudo bash deploy/restore.sh backups/voka-AAAA-MM-DD.sql.gz
  ```
  Antes de apagar, o script guarda o estado atual (`backups/voka-antes-restore-…`). Depois para o Voka, recria **apenas** o banco `voka`, carrega o backup e liga de novo.

## Remover
```bash
sudo bash deploy/uninstall.sh      # remove contentores e rede; dados ficam
docker volume rm voka_pgdata voka_uploads   # SÓ se quiser apagar os dados (irreversível)
```
Depois, remova o bloco do Voka do proxy reverso e as regras de firewall das portas 7881 e 7882.

## Como este kit foi testado
O kit foi testado numa máquina de teste com **nginx já ocupando as portas 80/443**, usando o exemplo `proxy-examples/nginx.conf` e um certificado próprio. Resultados:
- preflight sem erros;
- instalação e smoke-test completos;
- teste ponta a ponta no navegador: cadastro, servidores, convites, chat em tempo real, uploads, DM, **chamadas de voz e vídeo**;
- `update.sh`, depois `rollback.sh` com restauração do banco (o dado inserido depois do backup sumiu, como esperado), e `uninstall.sh` mantendo os volumes;
- consumo em repouso: app ~100 MB, banco ~64 MB, voz ~14 MB de RAM.

## Acompanhamento
| Para… | Comando (na pasta `deploy`) |
|---|---|
| Estado | `sudo docker compose ps` |
| Consumo | `sudo docker stats voka-app voka-postgres voka-livekit` |
| Logs | `sudo docker compose logs --tail 100 app` (ou `livekit`) |

O tráfego das chamadas ainda precisa ser medido em uso real. Acompanhe a rede no painel do provedor. Se o Voka crescer, aumente os `limits` no `docker-compose.yml` ou leve o `voka-livekit` para uma VPS separada.
