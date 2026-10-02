#!/usr/bin/env bash
# Turns a fresh Ubuntu 24.04 droplet into a development playground you can reach from any
# machine: a non-root `dev` user, Tailscale, tmux, Node + Claude Code, git, Postgres 16 and
# Playwright's Chromium (for tools/e2e), and every project listed in projects.txt.
#
#   curl -fsSL https://raw.githubusercontent.com/byndbelief/game-room/main/tools/devbox/bootstrap.sh | sudo bash
#   (or copy this folder over and run:  sudo ./bootstrap.sh)
#
#   sudo ./bootstrap.sh              # set everything up (safe to re-run)
#   sudo ./bootstrap.sh --lock-ssh   # after Tailscale works: close public SSH, allow it only over Tailscale
#   sudo ./bootstrap.sh --no-e2e     # skip Postgres + Chromium (smaller, faster)
#
# Safe to re-run: every step checks first. Nothing here touches production data or secrets.
set -euo pipefail

DEV_USER=${DEV_USER:-dev}
NODE_MAJOR=${NODE_MAJOR:-22}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")
PROJECTS=${PROJECTS_FILE:-$HERE/projects.txt}
E2E=1; LOCK=0
for a in "$@"; do case $a in --no-e2e) E2E=0;; --lock-ssh) LOCK=1;; *) echo "unknown option $a"; exit 2;; esac; done

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
as_dev() { sudo -u "$DEV_USER" -H bash -lc "$*"; }

# ---------------------------------------------------------------- lock down SSH (second pass)
if [ "$LOCK" = 1 ]; then
  say "Locking public SSH"
  command -v tailscale >/dev/null && tailscale ip -4 >/dev/null 2>&1 \
    || { echo "Tailscale isn't up. Run 'sudo tailscale up' and check you can ssh in over it first."; exit 1; }
  ufw allow in on tailscale0 to any port 22 proto tcp
  ufw delete allow 22/tcp >/dev/null 2>&1 || ufw delete allow OpenSSH >/dev/null 2>&1 || true
  ufw status
  echo "Public SSH is closed. Reach this box at: ssh $DEV_USER@$(tailscale ip -4 | head -1)"
  echo "(Lost access? DigitalOcean console -> Droplet -> Access -> Launch Droplet Console.)"
  exit 0
fi

# ---------------------------------------------------------------- packages
say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git tmux htop jq unzip build-essential python3 \
  ufw fail2ban unattended-upgrades sudo openssh-server ripgrep
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# ---------------------------------------------------------------- the dev user
say "User '$DEV_USER'"
id "$DEV_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEV_USER"
usermod -aG sudo "$DEV_USER"
echo "$DEV_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$DEV_USER && chmod 440 /etc/sudoers.d/90-$DEV_USER
H=$(getent passwd "$DEV_USER" | cut -d: -f6)
install -d -m 700 -o "$DEV_USER" -g "$DEV_USER" "$H/.ssh"
# Carry over the key DigitalOcean put on root, so you can log in as dev with the same key.
if [ -s /root/.ssh/authorized_keys ]; then
  touch "$H/.ssh/authorized_keys"
  cat /root/.ssh/authorized_keys >> "$H/.ssh/authorized_keys"
  sort -u "$H/.ssh/authorized_keys" -o "$H/.ssh/authorized_keys"
fi
chown "$DEV_USER:$DEV_USER" "$H/.ssh/authorized_keys" 2>/dev/null || true; chmod 600 "$H/.ssh/authorized_keys" 2>/dev/null || true
[ -s "$H/.ssh/authorized_keys" ] || { echo "No SSH key found for root or $DEV_USER: refusing to turn off passwords. Add your key and re-run."; exit 1; }

# A key of its own for GitHub (add the printed public key as a deploy key / to a bot account).
[ -f "$H/.ssh/id_ed25519" ] || sudo -u "$DEV_USER" ssh-keygen -t ed25519 -N "" -C "devbox-$(hostname)" -f "$H/.ssh/id_ed25519" >/dev/null
sudo -u "$DEV_USER" bash -c "grep -q github.com '$H/.ssh/known_hosts' 2>/dev/null || ssh-keyscan -t ed25519 github.com >> '$H/.ssh/known_hosts' 2>/dev/null"

# ---------------------------------------------------------------- SSH + firewall
say "SSH hardening and firewall"
cat > /etc/ssh/sshd_config.d/99-devbox.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
ClientAliveInterval 60
ClientAliveCountMax 10
CONF
sshd -t && systemctl reload ssh
ufw default deny incoming; ufw default allow outgoing
ufw allow OpenSSH            # closed later by:  sudo ./bootstrap.sh --lock-ssh
ufw --force enable
systemctl enable --now fail2ban

# ---------------------------------------------------------------- Tailscale
say "Tailscale"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable --now tailscaled
if ! tailscale ip -4 >/dev/null 2>&1; then
  if [ -n "${TS_AUTHKEY:-}" ]; then tailscale up --ssh --authkey "$TS_AUTHKEY"
  else echo "Tailscale installed but not logged in. After this script finishes, run:  sudo tailscale up --ssh"; fi
fi

# ---------------------------------------------------------------- Node + Claude Code
say "Node $NODE_MAJOR and Claude Code"
if ! node -v 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
npm install -g @anthropic-ai/claude-code

# ---------------------------------------------------------------- tmux + shell comfort
say "tmux and shell"
cat > "$H/.tmux.conf" <<'CONF'
set -g mouse on
set -g history-limit 100000
set -g default-terminal "tmux-256color"
set -g status-style "bg=#171331,fg=#e8e4ff"
set -g base-index 1
CONF
chown "$DEV_USER:$DEV_USER" "$H/.tmux.conf"
if ! grep -q "devbox" "$H/.bashrc"; then cat >> "$H/.bashrc" <<'CONF'

# --- devbox ---
alias work='tmux new-session -A -s work'          # attach to (or start) the one shared session
alias cc='claude'
# Log in over SSH and land in the shared tmux session (skip with:  NOTMUX=1 ssh ...)
if [ -n "$SSH_CONNECTION" ] && [ -z "$TMUX" ] && [ -z "$NOTMUX" ] && [ -t 0 ]; then exec tmux new-session -A -s work; fi
CONF
fi
as_dev 'git config --global user.name  >/dev/null || git config --global user.name  "'"${GIT_NAME:-Dev Box}"'"'
as_dev 'git config --global user.email >/dev/null || git config --global user.email "'"${GIT_EMAIL:-devbox@localhost}"'"'
as_dev 'git config --global init.defaultBranch main; git config --global pull.rebase false'

# ---------------------------------------------------------------- e2e prerequisites (r4box)
if [ "$E2E" = 1 ]; then
  say "Postgres 16 and Chromium (for tools/e2e)"
  apt-get install -y postgresql-16 postgresql-client-16 2>/dev/null || {
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
    apt-get update -y && apt-get install -y postgresql-16 postgresql-client-16
  }
  systemctl disable --now postgresql >/dev/null 2>&1 || true   # the e2e script runs its own throwaway instance
  npm install -g playwright
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx -y playwright install --with-deps chromium
  grep -q PLAYWRIGHT_BROWSERS_PATH /etc/environment || {
    echo 'PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> /etc/environment
    echo 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> /etc/environment; }
fi

# ---------------------------------------------------------------- projects
say "Projects"
as_dev 'mkdir -p ~/dev'
if [ -f "$PROJECTS" ]; then
  while read -r url name _; do
    case "$url" in ''|\#*) continue;; esac
    name=${name:-$(basename "$url" .git)}
    if as_dev "[ -d ~/dev/$name/.git ]"; then echo "  $name: already cloned (git pull to update)"
    elif as_dev "git clone '$url' ~/dev/$name"; then echo "  $name: cloned"
    else echo "  $name: clone FAILED (add the key below to GitHub, then re-run)"; MISSING_KEY=1; fi
  done < "$PROJECTS"
else
  echo "  no projects.txt next to this script, skipping (re-run from a checkout of tools/devbox to clone projects)"
fi

# ---------------------------------------------------------------- done
say "Done"
IP=$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
cat <<MSG
Next steps
  1. Log in as the dev user:   ssh $DEV_USER@$IP
  2. Tailscale:                sudo tailscale up --ssh      (then install Tailscale on your other machines)
  3. Close public SSH:         sudo ./bootstrap.sh --lock-ssh   (once step 2 works)
  4. GitHub access: add this public key as a deploy key (write access) on each repo in projects.txt,
     or to a dedicated bot account, then re-run this script to clone:

$(cat "$H/.ssh/id_ed25519.pub")

  5. Claude Code:              claude        (log in once; or export ANTHROPIC_API_KEY)
  6. r4box tests:              cd ~/dev/r4box && tools/e2e/setup.sh && \\
                               PLAYWRIGHT=\$(npm root -g)/playwright node tools/e2e/smoke.cjs
  7. Everyday:                 ssh in -> you land in tmux session 'work'; 'cc' starts Claude Code.

Keep production secrets (Supabase service-role key, VAPID private key) OFF this box.
Take a DigitalOcean snapshot now: it's your undo button.
MSG
