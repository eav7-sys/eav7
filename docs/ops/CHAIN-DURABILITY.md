# Durabilidade da cadeia (pós-incidente 12 ago 2026)

## O que quebrou

No boot, se o replay encontrava **um** bloco inválido, o nó truncava **todo** o rabo do
`blocks.jsonl` e seguia. Com os 7 nós a reiniciar juntos e sem peer com a tip, a rede
perdeu ~61k blocos.

A causa concreta do bloco inválido: `verificar_lote` não semeava `self.producer_keys`
entre lotes de 512, portanto o primeiro bloco do lote 2 (altura 513) falhava com
*"chave pública do produtor inválida"* — em **qualquer** cadeia, incluindo uma gênese
nova. Corrigido.

## Proteção no código

| Regra | Comportamento |
|---|---|
| Auto-discard default | No máximo **1** bloco no fim (crash típico no append) |
| Rabo maior | Boot **aborta**, arquivo **intacto**, mensagem com a causa |
| Force explícito | `--force-discard-invalid-tail` ou `EAV7_FORCE_DISCARD_INVALID_TAIL=1` |
| Antes de truncar (force ou 1 bloco) | Cópia `blocks.jsonl.pre-discard-<unix>.bak` |

**Nunca** ligues `EAV7_FORCE_DISCARD_INVALID_TAIL` em produção sem backup e sem um peer
que já tenha a tip. Um boot abortado é o sistema a funcionar — resolve-se restaurando ou
sincronizando, nunca a truncar.

Verificar que um nó tem o binário protegido:
```bash
strings /usr/local/bin/eav7-node | grep -c force-discard-invalid-tail   # tem de dar 1
```

---

## Snapshot de estado (`estado.snap`)

Gravado pelo próprio nó em `/var/lib/eav7/estado.snap` a cada
`SNAPSHOT_INTERVAL_BLOCKS` = **5000** (`rust/src/config.rs:29`), por
`talvez_snapshot()` (`rust/src/blockchain.rs:1929`), chamado do laço principal
(`rust/node/src/main.rs:302`).

Detalhes que importam em ops:

- O snapshot **só é gravado se o header tiver `stateRoot`** — sem isso não haveria como
  prová-lo no boot, e gravar seria produzir algo que será sempre recusado.
- A escrita é **assíncrona** (job em background) e best-effort; o intervalo é reservado
  no caminho quente para não empilhar jobs.
- No boot, o snapshot é **provado contra a raiz do header**. Se estiver corrompido ou for
  de outra cadeia, o nó cai em **replay completo** — e o replay, com a proteção acima,
  **não trunca**: ou reconstrói, ou aborta com o ficheiro intacto.

**Estado em 12 ago 2026:** a cadeia nova ainda não atingiu 5000 blocos, portanto
`estado.snap` ainda não existe em nenhum nó. O primeiro nasce na altura 5000. Não foi
baixado o intervalo — a ~1 bloco/s o primeiro snap chega em menos de uma hora, e mexer
numa constante de consenso para poupar esse tempo não compensa.

---

## Backup da cadeia (instalado)

### O que está a correr

Em **todos os 7 nós**:

| | |
|---|---|
| Script | `/usr/local/bin/eav7-backup-chain.sh` (fonte: `bin/eav7-backup-chain.sh`) |
| Unit | `eav7-backup.service` + `eav7-backup.timer` (fontes em `deploy/`) |
| Cadência | **horária** (`OnCalendar=hourly`, `Persistent=true`, jitter 300 s) |
| Destino | `/var/backups/eav7/<host>/latest` + `…/<YYYYMMDD>` |
| Retenção | 7 dias de diários; `latest` sempre atual |

Copia `blocks.jsonl`, `estado.snap`, `genesis.json`, `core.json`, `blocks.idx`,
`hashes.bin`.

**Não copia `validator-wallet.json`.** É material de chave e já está fora da VM, em
`secrets/foundation-ancoras/`. Espalhar chaves por diretórios de backup aumenta a
superfície sem acrescentar recuperação — o restore usa a wallet do cofre.

### Verificação

Cada corrida escreve `BACKUP.txt` com host, timestamp, nº de linhas, tip do ficheiro,
tip da API e sha256. **Se `tip_ficheiro` e `tip_api` divergirem, o backup apanhou uma
escrita a meio** — repetir.

```bash
sudo systemctl list-timers eav7-backup.timer
sudo cat /var/backups/eav7/$(hostname)/latest/BACKUP.txt
sudo /usr/local/bin/eav7-backup-chain.sh        # corrida manual
```

---

## Backup fora do ESXi (OneDrive / M365) — instalado

Só no **hub**. Os 7 nós convergem na mesma cadeia, portanto uma cópia boa fora do host
chega para recuperar a rede; os backups locais dos outros cobrem a recuperação nó-a-nó.
Isto mantém a credencial da nuvem em **uma** máquina em vez de sete.

| | |
|---|---|
| Script | `/usr/local/bin/eav7-backup-cloud.sh` (fonte: `bin/eav7-backup-cloud.sh`) |
| Unit | `eav7-backup-cloud.service` + `.timer` |
| Cadência | **diária**, 03:20 UTC (`Persistent=true`, jitter 600 s) |
| Remote | `eav7onedrive:` — OneDrive business, 1 TiB |
| Destino | `EAV7-backups/<host>/<host>-YYYYMMDD.tar.gz` |
| Retenção | 30 dias no destino |
| Config | `/root/.config/rclone/rclone.conf`, `0600 root:root` |

Envia o `latest` (estado no momento do envio), **não** o diretório diário — o diário é um
ponto-no-tempo da primeira corrida do dia e nunca mais avança; enviá-lo punha na nuvem uma
cópia até 24 h atrasada. Detetado num teste de restauro.

Usa `copyto`, não `sync`: um `sync` apagaria no destino o que não existe na origem, e a
origem é um diretório temporário. Um backup nunca deve poder apagar histórico no destino.

### ⚠️ Âmbito da credencial

O token foi emitido para `marketing@eav7.com`, que é **Global Administrator**, e o
consentimento concedido foi `Files.ReadWrite.All` + `Sites.Read.All` — ou seja,
**leitura e escrita em todos os ficheiros do tenant**, não apenas na drive do utilizador.

Consequência: se o hub for comprometido, o atacante tem acesso de escrita a todos os
ficheiros do `eav7.com`. O hub tem API pública e SSH expostos à Internet.

Mitigação recomendada (por fazer): registar uma app dedicada no Entra ID com apenas
`Files.ReadWrite` + `offline_access` delegados, autorizar com uma **conta de serviço sem
papéis de administrador**, e revogar este consentimento.

### Verificação e restauro da nuvem

```bash
sudo rclone ls eav7onedrive:EAV7-backups/
sudo rclone about eav7onedrive:

# restauro: trazer, extrair e conferir contra o BACKUP.txt incluído
T=$(mktemp -d)
sudo rclone copy eav7onedrive:EAV7-backups/eav7-hub/eav7-hub-YYYYMMDD.tar.gz "$T/"
sudo tar -xzf "$T"/*.tar.gz -C "$T"
sudo cat "$T/BACKUP.txt"; sudo sha256sum "$T/blocks.jsonl"
```

Round-trip validado em 12 ago 2026: 3264 linhas restauradas com o nó em 3265, sha256 a
bater com o `BACKUP.txt`.

### Pull manual alternativo (a partir do Mac)

```bash
mkdir -p ~/eav7-backups/$(date -u +%Y%m%d)
for ip in 152 153 154 155 156 157 158; do
  rsync -az -e "ssh -i ~/.ssh/eav7_esxi" \
    eav7@198.145.121.$ip:/var/backups/eav7/ ~/eav7-backups/$(date -u +%Y%m%d)/
done
```

### Escala

Compressão medida: **1,6×** (11 MB → 7 MB) — as assinaturas em base64 não comprimem.
A cadeia cresce ~384 MB/dia em bruto. Como cada envio é uma cópia integral, a ocupação
com 30 dias de retenção passa de ~100 GB ao fim de um mês para >500 GB ao fim de três.

Quando a cadeia passar de ~5 GB, mudar para envio **incremental**: o `blocks.jsonl` é
append-only, portanto dá para enviar só os blocos do dia como fatia separada.

---

## Restaurar UM nó a partir do backup

Sem tocar nos outros. O nó a restaurar deve estar **parado**.

```bash
ssh -i ~/.ssh/eav7_esxi eav7@<ip>
sudo systemctl stop eav7-core

# 1. preservar o estado atual (nunca apagar antes de validar o restore)
sudo mv /var/lib/eav7/blocks.jsonl /var/lib/eav7/blocks.jsonl.antes-restore-$(date -u +%s)

# 2. repor a partir do backup
B=/var/backups/eav7/$(hostname)/latest
sudo cp "$B/blocks.jsonl" /var/lib/eav7/blocks.jsonl
sudo rm -f /var/lib/eav7/blocks.idx /var/lib/eav7/hashes.bin   # o nó reindexa
sudo rm -f /var/lib/eav7/estado.snap                            # evita snap incoerente
sudo chown eav7:eav7 /var/lib/eav7/blocks.jsonl

# 3. subir e confirmar
sudo systemctl start eav7-core
sleep 30 && curl -s -H 'accept: application/json' http://127.0.0.1:6070/status
```

Se o backup estiver atrás da rede, o nó sincroniza a diferença dos peers — é o caminho
normal. **Se o boot abortar, não forçar truncate:** usar um backup mais antigo, ou
limpar o data dir e deixar sincronizar do zero a partir dos peers.

---

## ESXi

### Autostart (configurado em 12 ago 2026)

Estava **desativado** (`enabled = <unset>`, sequência vazia) — foi por isso que o reboot
do host deixou a rede inteira em baixo, com nenhuma VM a subir.

Agora: ativo, ordem **hub → a2 → a3 → a4 → a5 → a6 → a7**, `startDelay` 120 s,
`startAction=powerOn`, `stopAction=guestShutdown`.

```bash
vim-cmd hostsvc/autostartmanager/get_autostartseq          # conferir
vim-cmd hostsvc/autostartmanager/enable_autostart true
vim-cmd hostsvc/autostartmanager/update_autostartentry <vmid> "powerOn" "120" "<ordem>" "guestShutdown" "120" "systemDefault"
```

Após cold boot do host: esperar o hub responder `/status` com tip antes de contar com os
restantes. Se o autostart falhar, subir manualmente em rolling pela mesma ordem.

O `eav7-core` está `enabled` nos 7 (`systemctl is-enabled eav7-core`).

### Snapshots de VM

**Checklist obrigatório — snapshot das 7 VMs ANTES de:**

- reboot do host ESXi
- remap de RAM / alteração de hardware virtual
- upgrade de binário em massa
- qualquer manutenção do ESXi

```bash
for id in 1 2 3 4 5 6 7; do
  vim-cmd vmsvc/snapshot.create $id "eav7-<motivo>-$(date -u +%Y%m%d)" "<descrição>" 0 1
done
vim-cmd vmsvc/get.snapshotinfo <vmid>      # listar
vim-cmd vmsvc/snapshot.removeall <vmid>    # limpar quando validado
```

Argumentos finais: `0` = sem memória, `1` = quiesced (usa open-vm-tools).

**Snapshots são temporários.** O delta cresce com a escrita e degrada I/O. Apagar depois
de validar a manutenção; não deixar a viver dias.

Existente em 12 ago 2026: `eav7-pos-protecao-20260812` nas 7 VMs (cadeia viva + binário
com a proteção). Datastore: 644,9 GB livres no momento da criação.

### Política

Nunca reboot do host sem: backup recente **e** snapshot das VMs **e** confirmação de que
o binário tem a proteção.

---

## Rolling restart

Nunca reiniciar as 7 âncoras ao mesmo tempo. Foi assim que se perderam 7 cópias de uma
vez, em vez de 6 sobreviverem.

Um nó de cada vez, confirmando entre cada:
```bash
curl -s -H 'accept: application/json' http://127.0.0.1:6070/status   # altura mantida
```

---

## Tip canónica (`EAV7_FOLLOW`) — anti-fork definitivo

**Incidente 13–14 ago 2026:** restart do hub (replay ~10 min) → a2–a7 continuaram a
produzir → fork em h=76511 → `REORG_WINDOW` (5000) insuficiente → explorador só via o
hub; validadores “offline” na UI.

**Contrato operacional (lab 7 âncoras):**

| Nó | Papel | `EAV7_FOLLOW` |
|---|---|---|
| **hub** (`10.10.10.11`) | Intermediário canónico + explorer | *não definir* |
| **a2–a7** | Seguidores | `http://10.10.10.11:6070` |

Com follow activo, a2–a7 **só produzem** se a tip local = tip do hub. Se o hub estiver
em baixo / a divergir / nós à frente → **pausam** em vez de bifurcar.

Código: `rust/node/src/follow.rs`, flag `--follow` / env `EAV7_FOLLOW` (passado pelo
`eav7-core`). Também: sync P2P inicial antes do 1.º bloco (`boot_ready`, ~20 s máx.).

Heal de fork profundo (já ocorreu): `bin/eav7-heal-fork-to-hub.sh` /
`bin/eav7-heal-finish.sh` — copiam `blocks.jsonl` do hub; forks antigos ficam em
`/var/lib/eav7/fork-backup-*`.

---

## Testes de aceitação — resultados (12 ago 2026)

| # | Teste | Resultado |
|---|---|---|
| 1 | Marker `force-discard-invalid-tail` = 1 nos 7 nós | **PASS** |
| 2 | Restart de um peer (a7): altura mantém-se, peers > 0 | **PASS** — carregou do disco na altura 2963 (sem truncar), 0 abortos, 6 peers |
| 3 | Timer de backup nos 7; corrida criou dir com `blocks.jsonl` | **PASS** — `tip_ficheiro` == `tip_api` em todos |
| 4 | Doc atualizado com restore + ESXi + autostart | **PASS** (este ficheiro) |
| 5 | Restart usa snap ou replay sem truncate | **PARCIAL** — replay sem truncate: PASS. Boot por snapshot: FALHA (ver abaixo) |

### Achado (corrigido 14 ago 2026): boot por snapshot

Antes: `tail_start` do snap ficava atrás de `inicio_janela` após a ponta andar →
replay completo sempre. Agora o boot **avança a âncora** reaplicando do disco os
blocos deslizados (`blockchain.rs` / `load_from_snapshot`) e grava snap no
**shutdown** (`SIGTERM`/`SIGINT`) + intervalo `SNAPSHOT_INTERVAL_BLOCKS` = **1000**.

Gate estilo TRON: minerador faz **miss slot** se a tip local divergir / atrasar
vs peers (`follow.rs` / `check_peers`).

---

## O que não fazer

- Force-discard em massa "para o nó subir"
- Reboot do host sem snapshot + backup
- Reiniciar as 7 âncoras em paralelo
- Apagar `/var/lib/eav7.broken-*` ou `blocks.jsonl.*.bak` sem validar o restore
- Commitar wallets, seeds ou `.env`
