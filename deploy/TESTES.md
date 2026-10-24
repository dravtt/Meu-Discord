# Testes do kit v2 (24/10/2026)

Os testes foram feitos numa máquina de teste (Linux, Docker 27, Compose v2) que imita a TOWER:
- **nginx ocupando 80/443** com a config `nginx-fase2-https.conf` e um certificado próprio para o domínio de teste `voka.test`;
- `VOKA_PUBLIC_IP=127.0.0.1`.

Nada foi executado na TOWER.

**Legenda:** ✅ passou · ⚠️ só dá para validar na TOWER

## 1. Kit e configuração
| Teste | Resultado |
|---|---|
| `check-kit.sh`: nenhum arquivo com CRLF | ✅ |
| `bash -n` em todos os 12 scripts | ✅ |
| `docker compose config` com um `.env` de teste | ✅ |
| `nginx -t` com `nginx-fase1-http.conf` | ✅ |
| `nginx -t` com `nginx-fase2-https.conf` | ✅ |
| `install.sh` 1ª vez: só cria o `.env` (600) e para | ✅ |
| `install.sh` sem digitar `SIM`: sai com erro, nada é criado | ✅ |
| `install.sh` sem `NEXO_ADMIN_EMAILS`: recusa instalar | ✅ |
| Build da imagem (`docker compose build app`) | ✅ |
| Testes do servidor (vitest) | ✅ 43/43 |

## 2. Instalação e funcionamento
| Teste | Resultado |
|---|---|
| `install.sh` 2ª vez: 4 contentores `healthy`, 0 reinícios, testes locais 0 erros | ✅ |
| PostgreSQL sem porta publicada; contentores só na `voka_net` | ✅ |
| Limites efetivos (`docker inspect`): 0,8+0,5+0,6+0,1 = **2 vCPU**; 1536+1024+1024+256 = **3840 MB** | ✅ |
| `smoke-test.sh` pelo domínio: `/api/health`, `/rtc` 401, WebSocket 101, certificado | ✅ 0 erros |
| `rtc-check.sh`: portas, `node_ip`, `/rtc`, token de teste | ✅ 0 erros |
| Teste ponta a ponta no navegador (Chromium) **através do nginx**: cadastro, servidores, convites, chat em tempo real, menções, reações, tópicos, DM, upload, **ligação na DM e canal de voz com câmera** | ✅ |
| Admin por e-mail: com `NEXO_ADMIN_EMAILS=bia@…`, a 1ª conta (ana) recebe 403 no painel de admin e bia recebe 200 | ✅ |

**Consumo em repouso** (`docker stats`):
- app: 41 MB
- banco: 25 MB
- voz: 14 MB
- backup: 1,4 MB

## 3. Backups
| Teste | Resultado |
|---|---|
| `pg_dump` falha (senha errada): sai com erro, nenhum arquivo fica | ✅ |
| Dump truncado (interrompido a meio) é rejeitado | ✅ |
| gzip corrompido é rejeitado | ✅ |
| Dump bom é aceito e gravado de forma atómica (`.parcial` → nome final) | ✅ |
| Loop agendado: backup ao ligar, log `backup ok`, próximo às 03:30 | ✅ |
| Falha no loop: cria `FALHOU-ultimo-backup.txt`, `voka-backup` fica `unhealthy`, `smoke-test.sh` sai com erro | ✅ |
| Depois de um backup bom, o marcador some e volta a `healthy` | ✅ |

## 4. Atualização e rollback
| Teste | Resultado |
|---|---|
| **T7** `update.sh` com uma versão que traz uma migration nova (tabela nova), um usuário criado depois, e então `rollback.sh` | ✅ |
| **T8** `update.sh` com uma versão que **quebra ao iniciar**, e então `rollback.sh --manter-banco` | ✅ |

Detalhes do T7:
- a imagem voltou ao ID exato anterior (`0e9745230ea5`);
- a tabela nova sumiu e a migration deixou de estar registada;
- o usuário criado depois da atualização sumiu (como esperado);
- o banco da versão nova ficou guardado em `voka_antigo_…`.

Detalhes do T8:
- o `update.sh` saiu com erro e mostrou o comando de rollback;
- o rollback voltou à imagem anterior exata, `healthy`, e o smoke-test deu 0 erros.

## 5. Restauração
| Teste | Resultado |
|---|---|
| Backup corrompido: recusado antes de qualquer mudança | ✅ |
| **T9** backup cujo SQL falha a meio do carregamento: o banco temporário é apagado e o banco atual fica intacto, sem o Voka parar | ✅ |
| **T10** falha simulada **entre as duas trocas de nome** (`VOKA_TESTE_FALHA_TROCA=1`): o banco original volta, o temporário é apagado e o app é religado `healthy` | ✅ |
| Restauração bem-sucedida (dentro do T7) | ✅ |

## 6. Trava, remoção e reinstalação
| Teste | Resultado |
|---|---|
| **T11** com outra operação a segurar a trava, `update.sh` e `restore.sh` são recusados | ✅ |
| **T12** `uninstall.sh`: contentores e rede removidos; `voka_pgdata`, `voka_uploads` e os backups ficam | ✅ |
| **T13** `install.sh` de novo por cima dos dados guardados: os usuários continuam lá, smoke e rtc com 0 erros | ✅ |

## 7. O que só pode ser validado na TOWER
- ⚠️ **Firewall do provedor e do servidor**: TCP 7881 / UDP 7882 a chegar de fora. Use `nc -vz IP 7881` de outra máquina e https://livekit.io/connection-test com o token do `rtc-check.sh`.
- ⚠️ **Chamada real entre redes diferentes** (Wi-Fi × 4G). Na máquina de teste, as duas pontas estavam no mesmo host.
- ⚠️ **NAT da VPS**: se o IP público não estiver na interface da VPS, confirmar que as portas mantêm o mesmo número por fora e por dentro.
- ⚠️ **Certificado real** do Let's Encrypt (certbot, fase 1 → fase 2) e `certbot renew --dry-run`.
- ⚠️ **Consumo com uso real**: acompanhar `docker stats` e o tráfego de rede no painel durante chamadas.
- TURN/TLS na 443 **não** está ativo. A alternativa para redes que bloqueiam UDP é o TCP 7881. Redes que só deixam passar a 443 vão precisar de TURN/TLS, como fase posterior.

## Observações sobre o ambiente de teste
O build usou uma cópia temporária do `Dockerfile` com um espelho do Docker Hub e um certificado da máquina de teste, por limite de downloads. Essa alteração **não** está no kit: o `Dockerfile` entregue é o original.
