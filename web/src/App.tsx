import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { BlockPage } from './pages/BlockPage';
import { TxPage } from './pages/TxPage';
import { AddressPage } from './pages/AddressPage';
import { BlocksPage } from './pages/BlocksPage';
import { Wallet } from './pages/Wallet';
import { Mining } from './pages/Mining';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/explorer" element={<Home />} />
        <Route path="/blocks" element={<BlocksPage />} />
        <Route path="/block/:id" element={<BlockPage />} />
        <Route path="/tx/:id" element={<TxPage />} />
        <Route path="/address/:addr" element={<AddressPage />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/app" element={<Mining />} />
        <Route path="/mining" element={<Navigate to="/app" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
