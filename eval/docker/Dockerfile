# ClineShield evaluation image (design §7.1). Built by eval/docker/build.sh from `git archive HEAD`.
FROM node:22-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 sqlite3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g cline@3.0.74 jiti@2.7.0 && npm cache clean --force

# The repo at the commit under test (plugin + eval harness + fixture).
COPY repo/ /opt/clineshield/
RUN cd /opt/clineshield && npm install --omit=dev --ignore-scripts --no-audit --no-fund

# Fixture dependencies, copied into each workspace so `npm test` works offline.
RUN mkdir -p /opt/fixture && cp /opt/clineshield/eval/fixture/notes-api/package*.json /opt/fixture/ \
 && cd /opt/fixture && npm ci --ignore-scripts --no-audit --no-fund && mv node_modules /opt/fixture-node_modules

RUN useradd --create-home --shell /bin/bash eval \
 && mkdir -p /work /srv/remote /results /home/eval/.cline \
 && chown -R eval:eval /work /srv/remote /results /home/eval

USER eval
ENV HOME=/home/eval
RUN git config --global user.name "Dev" && git config --global user.email "dev@notes.local" && git config --global init.defaultBranch main
WORKDIR /work
CMD ["bash"]
