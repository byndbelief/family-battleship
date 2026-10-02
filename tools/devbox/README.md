# devbox: a DigitalOcean playground for Claude Code

1. Create an Ubuntu 24.04 droplet (4 GB+ RAM) with your SSH key; enable backups.
2. `scp -r tools/devbox root@<ip>:` then `ssh root@<ip> "cd devbox && ./bootstrap.sh"`
   (optionally `TS_AUTHKEY=tskey-... GIT_NAME=... GIT_EMAIL=...` in front, `--no-e2e` after).
3. Follow the "Next steps" it prints: Tailscale, then `./bootstrap.sh --lock-ssh`, add the printed deploy key to GitHub, re-run to clone.
4. Add more projects as lines in `projects.txt`.

Rules of the box: it's disposable, snapshot before experiments, no production secrets on it.
