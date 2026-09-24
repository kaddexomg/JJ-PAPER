# 🔧 INSTRUCCIONES PARA EL AGENTE LOCAL — Reparación Puente MixNet
# Fecha: 24-09-2026
# Ejecutar en: PC Supervisor (192.168.0.172) — donde corre wa-server
# 
# CONTEXTO: Los pedidos de JJ Paper no llegaban a MixNet porque el auto-detect
# había configurado primary_dir = "C:/Cotizaciones JJ" en vez de "M:/comp01".
# Este documento contiene los pasos exactos para reparar la conexión.
#
# REGLA FUNDAMENTAL: El wa-server SOLO corre en esta PC, NUNCA en la laptop.

## PASO 1: VERIFICAR UNIDAD M:
# Ejecutar: net use M:
# Si falla: net use M: \\192.168.0.185\comp01 /persistent:yes
# Verificar: dir M:\comp01\MXENCPED.DBF

## PASO 2: GIT PULL
# cd "C:\Users\PC\Desktop\JJ PAPER"
# git pull origin main

## PASO 3: EJECUTAR REPARADOR
# cd wa-server
# node fix-puente-mixnet.mjs

## PASO 4: MATAR INSTANCIAS ANTIGUAS
# taskkill /f /im node.exe

## PASO 5: REINICIAR WA-SERVER
# timeout /t 3
# node src/index.js

## PASO 6: VERIFICAR STATUS
# curl http://localhost:8787/lan/mixnet/status
# DEBE MOSTRAR: "primary_dir": "M:/comp01", "dbf_dir": "M:/comp01"
