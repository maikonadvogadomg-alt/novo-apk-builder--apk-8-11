/**
 * Função principal do aplicativo.
 * 
 * @returns {JSX.Element} O componente principal do React.
 * 
 * @example
 * // Exemplo de uso
 * import ReactDOM from 'react-dom';
 * import App from './App';
 * 
 * ReactDOM.render(<App />, document.getElementById('root'));
 */
function App() {
  return (
    <div>
      <TerminalTab />
      <ApkAnalyzer />
      {/* Outros componentes */}
    </div>
  );
}
