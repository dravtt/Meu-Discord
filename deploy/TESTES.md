# Testes do kit (v2, v3 e v3.1, 24/10/2026)

Os testes foram feitos numa máquina de teste (Linux, Docker 27, Compose v2) que imita a TOWER:
- **nginx ocupando 80/443** com a config `nginx-fase2-https.conf` e um certificado próprio para o domínio de teste `voka.test`;
- `VOKA_PUBLIC_IP=127.0.0.1`.

Nada foi executado na TOWER.

**Legenda:** ✅ passou · ⚠️ só dá para validar na TOWER

## 1. Kit e configuração
| Teste | Resultado |
|---|---|
| `check-kit.sh`: nenhum arquivo com CRLF | ✅ |
| `bash -n` em todos os 13 scripts | ✅ |
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
- ⚠️ **Cópia externa para a máquina real** (KHUMOTONE ou outra): chave, conta restrita e primeiro envio.
- ⚠️ **Consumo com uso real**: acompanhar `docker stats` e o tráfego de rede no painel durante chamadas.
- TURN/TLS na 443 **não** está ativo. A alternativa para redes que bloqueiam UDP é o TCP 7881. Redes que só deixam passar a 443 vão precisar de TURN/TLS, como fase posterior.

## 8. Kit v3: pendências da auditoria
Os testes desta seção foram feitos com o kit v3 instalado do zero. Na máquina de teste havia o nginx em 80/443 e um servidor SSH como destino da cópia externa.

| Teste | Resultado |
|---|---|
| **Build limitado**: `install.sh` e `update.sh` constroem no `voka-builder`; `docker inspect` do builder mostra `CpuQuota=200000/CpuPeriod=100000` (2 vCPU), `Memory=MemorySwap=3221225472` (3 GB, sem swap) | ✅ |
| Build sem cache medido dentro do builder (amostras a cada ~2 s): pico de ~53% de 1 vCPU e ~424 MB de RAM | ✅ |
| O builder fica parado (`Exited`) depois do build; `uninstall.sh` remove-o | ✅ |
| **Admin**: `install.sh` recusa `NEXO_ADMIN_EMAILS=ana` (inválido), recusa `NEXO_ADMINS=…` e recusa `NEXO_FIRST_USER_ADMIN=on` | ✅ |
| Servidor com `NODE_ENV=production` e `NEXO_ADMINS=jacques`: lista de admins por usuário **vazia**, `firstUserAdmin=false` | ✅ |
| `smoke-test.sh` confere dentro do `voka-app`: NEXO_ADMIN_EMAILS com 1 e-mail, sem NEXO_ADMINS, sem NEXO_FIRST_USER_ADMIN, NODE_ENV=production (sem mostrar valores) | ✅ |
| **Cópia externa** `backup-offsite.sh`: banco + pacote dos uploads enviados por SSH a uma conta restrita; conferência `--checksum` sem diferenças; marcador `.copia-externa-ok` | ✅ |
| Destino inacessível: sai com erro, cria `FALHOU-copia-externa.txt`, `smoke-test.sh` sai com erro; volta ao normal na cópia seguinte | ✅ |
| Arquivo adulterado no destino: a cópia seguinte o substitui e a conferência passa | ✅ |
| **Restauração a partir da cópia externa**: backup trazido do destino e restaurado com `restore.sh` (a tabela criada depois sumiu, as 11 migrations ficaram) | ✅ |
| `update.sh` com o build limitado: saudável, smoke-test 0 erros | ✅ |
| Teste ponta a ponta no navegador através do nginx, de novo com o kit v3: cadastro, convites, chat, DM, upload, ligações e canal de voz com câmera | ✅ |
| `smoke-test.sh` pelo domínio, completo | ✅ 0 erros, 0 avisos |

Notas:
- O pico do build foi medido com o cache de pacotes do npm desta máquina. Na TOWER, o primeiro build baixa tudo e pode demorar mais, mas continua dentro do teto de 2 vCPU / 3 GB.
- Ao ser criado, o `voka-builder` baixa a imagem `moby/buildkit` do Docker Hub, uma vez só.
- O teste ponta a ponta para numa etapa que depende da loja Steam (busca de jogos no perfil). Ela não tem acesso à internet na máquina de teste, e isso não tem relação com o kit.

## 9. TOWER sem buildx (builder clássico)
A auditoria da TOWER mostrou `docker: unknown command: docker buildx`. Para não mexer no Docker de lá, o kit agora também funciona sem o plugin. Os testes desta seção foram feitos **com o plugin buildx retirado** da máquina de teste.

| Teste | Resultado |
|---|---|
| `preflight.sh` sem buildx: "o build usa o builder clássico do Docker, com o mesmo teto" (sem erro) | ✅ |
| Build clássico com o teto padrão novo (1 vCPU / 2 GB): cada etapa (`npm ci`, `npm run build`…) roda num contentor com `CpuQuota=100000`, `Memory=MemorySwap=2147483648` (`docker inspect` durante o build) | ✅ |
| Com teto de 2 vCPU / 3 GB: `CpuQuota=200000`, `Memory=3221225472`; pico medido de ~200% CPU (2 vCPU, o teto) e ~280 MB de RAM | ✅ |
| `install.sh` completo sem buildx: 4 contentores saudáveis, smoke 0 erros | ✅ |
| `update.sh` sem buildx, e depois `rollback.sh --manter-banco` | ✅ |
| Nenhum contentor temporário do build fica para trás (`--force-rm`) | ✅ |

Consumo máximo durante uma atualização: 2 vCPU / 3,75 GB (contentores) + 1 vCPU / 2 GB (build) = **3 vCPU / 5,75 GB**, só durante o build. Fora do build, o máximo é 2 vCPU / 3,75 GB.

## Observações sobre o ambiente de teste
O build usou uma cópia temporária do `Dockerfile` com um espelho do Docker Hub e um certificado da máquina de teste, por limite de downloads. Pelo mesmo motivo, o `voka-builder` de teste foi criado com `VOKA_BUILDKIT_IMAGE` e `VOKA_BUILDKIT_CONFIG` (espelho), duas opções que ficam vazias na TOWER. Essa alteração **não** está no kit: o `Dockerfile` entregue é o original.
