FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY prisma ./prisma
COPY . .
RUN pnpm db:generate \
    && pnpm build \
    && find dist/generated/prisma -type f -name '*.js' -exec sed -i -e 's/\.ts"/.js"/g' -e "s/\.ts'/.js'/g" {} +

EXPOSE 3000

CMD ["pnpm", "start:prod"]
