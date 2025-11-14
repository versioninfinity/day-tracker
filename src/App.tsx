import { useEffect, useState } from "react";
import "./App.css";
import SimpleCalendar from "./components/SimpleCalendar";
import { storageService } from "./services/storage";

function App() {
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize storage infrastructure on app startup
    async function initStorage() {
      try {
        await storageService.initialize();
        setStorageReady(true);

        // Log storage info
        const config = await storageService.getStorageConfig();
        if (config) {
          console.log('📊 Storage Info:');
          console.log(`   Path: ${config.storage_path}`);
          console.log(`   Size: ${(config.total_size_bytes / 1024 / 1024).toFixed(2)} MB`);
          console.log(`   Created: ${new Date(config.created_at).toLocaleString()}`);
        }
      } catch (error) {
        console.error('Failed to initialize storage:', error);
        setStorageError(error instanceof Error ? error.message : 'Unknown error');
      }
    }

    initStorage();

    // Cleanup on unmount
    return () => {
      storageService.close();
    };
  }, []);

  if (storageError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>⚠️ Storage Initialization Error</h2>
        <p style={{ color: 'red' }}>{storageError}</p>
        <p>Please check the console for more details.</p>
      </div>
    );
  }

  if (!storageReady) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>🚀 Initializing Storage...</h2>
        <p>Setting up local storage infrastructure</p>
      </div>
    );
  }

  return <SimpleCalendar />;
}

export default App;
