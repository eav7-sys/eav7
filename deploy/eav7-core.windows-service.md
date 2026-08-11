# A4 — eav7-core / eav7-node como serviço no Windows

O release (`release-core.yml`) publica `eav7-core.exe` e `eav7-node.exe`.
Não há instalador MSI oficial; o caminho suportado é serviço via NSSM ou `sc.exe`.

## NSSM (recomendado)

1. Baixe [NSSM](https://nssm.cc/) e coloque `nssm.exe` no PATH.
2. Instale:

```bat
nssm install EAV7Core "C:\eav7\eav7-core.exe" run --dir C:\eav7\data
nssm set EAV7Core AppDirectory C:\eav7
nssm set EAV7Core AppEnvironmentExtra EAV7_NODE_BIN=C:\eav7\eav7-node.exe
nssm set EAV7Core Start SERVICE_AUTO_START
nssm start EAV7Core
```

Antes: `eav7-core init --dir C:\eav7\data --mode validator` (e backup da carteira).

## sc.exe (nativo)

Crie um wrapper `.bat` que chame o binário (sc não passa bem args complexos) e registre:

```bat
sc create EAV7Core binPath= "C:\eav7\run-core.bat" start= auto
sc start EAV7Core
```

Exemplo `run-core.bat`:

```bat
@echo off
set EAV7_NODE_BIN=C:\eav7\eav7-node.exe
C:\eav7\eav7-core.exe run --dir C:\eav7\data
```

Desative sleep do Windows e libere a porta da API no firewall se for ouvinte público.

## Checagem

```bat
eav7-core status --dir C:\eav7\data
eav7-core health --dir C:\eav7\data
```
