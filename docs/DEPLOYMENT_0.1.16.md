# Implantação 0.1.16 — 02/10/2026

Código da release: `95896031aba2bd5691d2a28c3a0c07a191344512`, tag `v0.1.16`. A tag `v0.1.15` foi preservada; seus workflows falharam na avaliação antes de publicar artefatos.

## Servidor

Backend implantado via `ops/update-server-from-tag.sh v0.1.16`, após 67 testes aprovados no próprio servidor Linux. Release ativa: `/home/usuario/apps/telae/server/releases/v0.1.16-1790979836`.

O origin agora atende em `127.0.0.1:5015`. O cloudflared existente continua encaminhando `https://telae.nicolasportie.com`; o backend confia somente em `127.0.0.1` para `CF-Connecting-IP`. Health pública respondeu `status=ok`, STUN e TURN configurados. O campo `relayReachability=unverified` é intencional: health não executa teste de mídia.

Coturn instalado e habilitado no systemd, usando `/etc/telae/turnserver.conf` protegido com `0640 root:turnserver`. Segredo REST aleatório compartilhado com o backend, arquivo de ambiente `0600 nicolas:nicolas`, TTL 3600 segundos. Nenhum segredo consta deste documento ou do Git.

TURN usa UDP/TCP 3478 e faixa de relay 49160–49260 UDP, IP público/NAT para a interface LAN, dois threads de relay, quotas e bloqueio de destinos internos/loopback/multicast. As regras de firewall já existentes cobriam essas portas. O endereço IPv4 público foi configurado diretamente: se o WAN mudar, atualize `external-ip` no coturn e `Turn__Urls` no ambiente do backend. HTTP via Cloudflare não encaminha tráfego TURN. TLS para TURN e DNS dedicado não foram provisionados; a mídia WebRTC usa DTLS-SRTP.

O E2E de relay obrigatório recebeu frames reais usando o endpoint público de sinalização e o TURN de produção. Os clientes estavam na mesma máquina da LAN e usaram o endereço WAN do TURN; isso comprova o caminho testado com NAT hairpin, sem substituir validação de outra rede/provedor.

A execução completa contra a produção aprovou quatro testes: captura de áudio da janela, convite inválido, transmissão com controles/troca/remoção e relay obrigatório. Carga prolongada foi omitida nessa execução.

Backups protegidos do ambiente e dos perfis após implantação ficam em `/home/usuario/apps/telae/backups`. As releases anteriores continuam disponíveis em `/home/usuario/apps/telae/server/releases` para rollback.

## Publicação desktop

Workflow: [release v0.1.16](https://github.com/NicolasPortie/Telae/actions/runs/37072206661). Validação contínua de main: [checks](https://github.com/NicolasPortie/Telae/actions/runs/37072203547).

Todos os jobs da release terminaram aprovados: readiness, mídia real, servidor, instalador e publicação no runner Linux. [Release publicada](https://github.com/NicolasPortie/Telae/releases/tag/v0.1.16) com EXE, blockmap e manifesto. O manifesto público `/updates/windows/latest.yml` indica 0.1.16. O instalador público foi baixado integralmente (157123491 bytes) e o SHA-512 correspondeu ao manifesto; o hash também foi verificado no servidor. Authenticode: `NotSigned`.

SHA-512 em base64: `zL/VRTmVPQwhvxr0pQ2peQ7g06o+t4p/Hr5CaV01LcFI13uOHobCin0s7qWCs2RKIG0guREPdBo13o/6VO8Bwg==`.

Runner Windows temporário em sessão interativa registrado com label `telae-media`; a instalação do .NET usa um diretório gravável do usuário. O runner é efêmero e sai após o job. O runner Linux `telae-updates` publica o instalador e troca `latest.yml` por último, após verificar SHA-512.

O job de mídia aprovou os testes reais e o runner foi automaticamente desregistrado. A credencial temporária de consulta de runners foi removida e `TELAE_MEDIA_RUNNER_READY=false` evita que próximas tags afirmem disponibilidade inexistente. Para outra publicação, prepare novamente a sessão Windows, registre o runner e configure o token de leitura de runners conforme `RELEASE_VALIDATION.md`. Defina `DOTNET_INSTALL_DIR` para uma pasta gravável antes de iniciar `run.cmd` quando a conta não puder instalar em `Program Files`. A pasta local `.release-runner` permanece ignorada pelo Git porque a revisão automática bloqueou sua remoção recursiva.

O certificado de assinatura Windows não foi fornecido. O instalador mantém o comportamento unsigned da distribuição existente. Medições acústicas de sincronização, glass-to-glass e endurance de uma hora não foram realizadas neste deploy.
