export type Lang = 'pt' | 'en' | 'es';

type Dict = Record<string, string>;

export const STRINGS: Record<Lang, Dict> = {
  pt: {
    nav_explorer: 'Explorador', nav_wallet: 'Carteira', nav_mining: 'Mineração', nav_docs: 'API',
    search_ph: 'Buscar por endereço / hash / bloco / token', search_history: 'Histórico de busca', clear_hist: 'limpar', results: 'Resultados',
    t_height: 'Altura', t_supply: 'Supply', t_burned: 'Queimado', t_reward: 'Recompensa/bloco',
    t_blocktime: 'Tempo de bloco', t_validators: 'Validadores', t_mempool: 'Mempool', t_energy: 'Energia',
    t_aioracles: 'Oráculos IA', latest_blocks: 'Últimos blocos', latest_txs: 'Últimas transações',
    th_block: 'Bloco', th_producer: 'Produtor', th_txs: 'Txs', th_age: 'Idade', th_type: 'Tipo',
    th_from: 'De', th_to: 'Para', th_value: 'Valor', th_fee: 'Taxa', th_date: 'Data', th_hash: 'Hash',
    no_txs: 'nenhuma transação ainda', chart_txs: 'Transações por bloco', chart_producers: 'Produção por validador',
    p_block: 'Bloco', p_tx: 'Transação', p_address: 'Endereço', p_blocks: 'Blocos', p_txs: 'Transações',
    customize: 'Personalizar', language: 'Idioma', theme: 'Tema', dark: 'Escuro', light: 'Claro',
    time_format: 'Formato de hora', timezone: 'Fuso', loading: 'carregando…', not_found: 'não encontrado',
    energy_consumed: 'Energia consumida', reward_block: 'EAV7/bloco', supply_circ: 'em circulação',
  },
  en: {
    nav_explorer: 'Explorer', nav_wallet: 'Wallet', nav_mining: 'Mining', nav_docs: 'API',
    search_ph: 'Search by address / hash / block / token', search_history: 'Search history', clear_hist: 'clear', results: 'Results',
    t_height: 'Height', t_supply: 'Supply', t_burned: 'Burned', t_reward: 'Reward/block',
    t_blocktime: 'Block time', t_validators: 'Validators', t_mempool: 'Mempool', t_energy: 'Energy',
    t_aioracles: 'AI oracles', latest_blocks: 'Latest blocks', latest_txs: 'Latest transactions',
    th_block: 'Block', th_producer: 'Producer', th_txs: 'Txs', th_age: 'Age', th_type: 'Type',
    th_from: 'From', th_to: 'To', th_value: 'Value', th_fee: 'Fee', th_date: 'Date', th_hash: 'Hash',
    no_txs: 'no transactions yet', chart_txs: 'Transactions per block', chart_producers: 'Production by validator',
    p_block: 'Block', p_tx: 'Transaction', p_address: 'Address', p_blocks: 'Blocks', p_txs: 'Transactions',
    customize: 'Customize', language: 'Language', theme: 'Theme', dark: 'Dark', light: 'Light',
    time_format: 'Time format', timezone: 'Timezone', loading: 'loading…', not_found: 'not found',
    energy_consumed: 'Energy consumed', reward_block: 'EAV7/block', supply_circ: 'circulating',
  },
  es: {
    nav_explorer: 'Explorador', nav_wallet: 'Billetera', nav_mining: 'Minería', nav_docs: 'API',
    search_ph: 'Buscar por dirección / hash / bloque / token', search_history: 'Historial de búsqueda', clear_hist: 'limpiar', results: 'Resultados',
    t_height: 'Altura', t_supply: 'Supply', t_burned: 'Quemado', t_reward: 'Recompensa/bloque',
    t_blocktime: 'Tiempo de bloque', t_validators: 'Validadores', t_mempool: 'Mempool', t_energy: 'Energía',
    t_aioracles: 'Oráculos IA', latest_blocks: 'Últimos bloques', latest_txs: 'Últimas transacciones',
    th_block: 'Bloque', th_producer: 'Productor', th_txs: 'Txs', th_age: 'Edad', th_type: 'Tipo',
    th_from: 'De', th_to: 'Para', th_value: 'Valor', th_fee: 'Comisión', th_date: 'Fecha', th_hash: 'Hash',
    no_txs: 'aún no hay transacciones', chart_txs: 'Transacciones por bloque', chart_producers: 'Producción por validador',
    p_block: 'Bloque', p_tx: 'Transacción', p_address: 'Dirección', p_blocks: 'Bloques', p_txs: 'Transacciones',
    customize: 'Personalizar', language: 'Idioma', theme: 'Tema', dark: 'Oscuro', light: 'Claro',
    time_format: 'Formato de hora', timezone: 'Zona', loading: 'cargando…', not_found: 'no encontrado',
    energy_consumed: 'Energía consumida', reward_block: 'EAV7/bloque', supply_circ: 'en circulación',
  },
};

export const localeOf: Record<Lang, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
