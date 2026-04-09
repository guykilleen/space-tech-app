import { createContext, useContext, useState } from 'react';

export const QBDirtyContext = createContext({ isDirty: false, setIsDirty: () => {} });

export function QBDirtyProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false);
  return (
    <QBDirtyContext.Provider value={{ isDirty, setIsDirty }}>
      {children}
    </QBDirtyContext.Provider>
  );
}

export function useQBDirty() {
  return useContext(QBDirtyContext);
}
