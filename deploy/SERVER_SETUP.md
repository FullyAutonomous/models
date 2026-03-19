# Server Setup (one-time)

Run these steps once on the dedicated Linux/Ubuntu server before the first deploy.

## 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

## 2. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

## 3. Create deploy user and directories

```bash
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /opt/models-dev/{dist,server}
sudo chown -R deploy:deploy /opt/models-dev
```

## 4. Create env file for secrets

```bash
sudo mkdir -p /etc/models-dev
echo "POSTHOG_TOKEN=your_token_here" | sudo tee /etc/models-dev/env
sudo chmod 600 /etc/models-dev/env
```

## 5. Install systemd service

```bash
# After the first deploy, models-dev.service will be in /opt/models-dev/server/../deploy/
sudo cp /opt/models-dev/deploy/models-dev.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable models-dev
```

## 6. Configure Caddy

Copy the `Caddyfile` from the repo to `/etc/caddy/Caddyfile`, replacing `your-domain.com` with your actual domain:

```bash
sudo cp /opt/models-dev/Caddyfile /etc/caddy/Caddyfile  # if synced
# OR edit /etc/caddy/Caddyfile directly and paste the contents
sudo systemctl restart caddy
```

## 7. Allow deploy user to restart the service without a password

```bash
echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart models-dev, /usr/bin/systemctl is-active models-dev" | sudo tee /etc/sudoers.d/deploy
sudo chmod 440 /etc/sudoers.d/deploy
```

## 8. Add deploy SSH key

Generate a key pair for CI:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub >> /home/deploy/.ssh/authorized_keys
```

Add the **private key** (`~/.ssh/deploy_key`) as the `SSH_PRIVATE_KEY` secret in GitHub repo settings.

Also add:
- `SSH_HOST` — server IP or hostname
- `SSH_USER` — `deploy`
