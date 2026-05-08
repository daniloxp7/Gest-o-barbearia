# Sistema de Gestão de Barbearia

Aplicação para gerenciamento de barbearia com painel administrativo, agenda interna e página pública de agendamento.

## Como usar

1. Abra o terminal em `C:\Users\danil\Documents\barbearia`
2. Execute:
   - `npm install`
   - `npm start`
3. Abra no navegador:
   - Painel: `http://localhost:3000`
   - Agendamento público: `http://localhost:3000/booking.html`

## Funcionalidades

- Login com autenticação JWT
- Cadastro, edição e exclusão de clientes
- Cadastro, edição e exclusão de barbeiros
- Cadastro, edição e exclusão de serviços
- Cadastro, edição e exclusão de agendamentos
- Agendamento público com validação de disponibilidade por duração do serviço
- Relatórios de faturamento e produtividade
- Gerenciamento de usuários por administradores

## Login padrão de desenvolvimento

- Usuário: `admin`
- Senha: `admin123`

Defina `INITIAL_ADMIN_PASSWORD` antes do primeiro uso em produção. Em produção, o sistema não cria o usuário inicial com senha padrão.

## Variáveis de ambiente recomendadas

- `JWT_SECRET`: chave secreta obrigatória em produção.
- `INITIAL_ADMIN_PASSWORD`: senha do administrador inicial.
- `CORS_ORIGIN`: origens permitidas, separadas por vírgula, quando a API for acessada por outro domínio.
- `PORT`: porta do servidor, padrão `3000`.

## Perfis de usuário

- `admin`: acesso completo, incluindo usuários.
- `manager`: acesso ao painel operacional.
- `attendant`: acesso ao painel operacional.

## Estrutura

- `server.js`: servidor Express + API REST
- `db.js`: banco SQLite local
- `public/`: frontend em HTML, CSS e JavaScript
- `barbearia.db`: banco de dados local gerado automaticamente

## Verificação

Execute `npm run check` para validar a sintaxe dos principais arquivos JavaScript.
