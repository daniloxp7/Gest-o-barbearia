# Sistema de Gestão de Barbearia

Aplicação simples para gerenciamento de barbearia com cadastro de clientes, barbeiros, serviços e agendamentos.

## Como usar

1. Abra o terminal em `c:\Users\danil\Documents\barbearia`
2. Execute:
   - `npm install`
   - `npm start`
3. Abra no navegador:
   - `http://localhost:3000`

## Funcionalidades

- Login e autenticação
- Cadastro, edição e exclusão de clientes
- Cadastro, edição e exclusão de barbeiros
- Cadastro, edição e exclusão de serviços
- Cadastro, edição e exclusão de agendamentos
- Relatórios de faturamento e produtividade

## Login padrão

- Usuário: `admin`
- Senha: `admin123`

## Gerenciamento de usuários

- O administrador pode criar, editar e excluir usuários.
- Funções disponíveis: `admin`, `manager`, `attendant`.
- O botão de usuários fica visível apenas para administradores.

## Estrutura

- `server.js` - servidor Express + API REST
- `db.js` - banco SQLite local
- `public/` - frontend em HTML, CSS e JavaScript
- `barbearia.db` - banco de dados gerado automaticamente

## Observações

Se o seu Node.js estiver em versão antiga, considere atualizar para Node 18+ para evitar avisos de compatibilidade.
