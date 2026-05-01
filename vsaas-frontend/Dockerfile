FROM node:20-alpine

WORKDIR /app

# Instala dependências primeiro (cache layer)
COPY package*.json ./
RUN npm install

# Copia o código fonte
COPY . .

EXPOSE 5173

# Vite com host 0.0.0.0 para aceitar conexões externas ao container
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
