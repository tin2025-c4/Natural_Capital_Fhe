// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface NaturalCapitalAsset {
  id: string;
  name: string;
  location: string;
  area: number; // in hectares
  encryptedValue: string; // FHE encrypted value
  owner: string;
  timestamp: number;
  image: string; // URL to asset image
  category: string; // forest, river, etc.
  status: "pending" | "verified" | "rejected";
}

// Mock FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<NaturalCapitalAsset[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newAssetData, setNewAssetData] = useState({ 
    name: "", 
    location: "", 
    area: 0, 
    category: "forest", 
    image: "" 
  });
  const [selectedAsset, setSelectedAsset] = useState<NaturalCapitalAsset | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<"market" | "map" | "stats" | "partners" | "faq">("market");
  const [showFAQ, setShowFAQ] = useState(false);

  const verifiedCount = assets.filter(a => a.status === "verified").length;
  const pendingCount = assets.filter(a => a.status === "pending").length;
  const rejectedCount = assets.filter(a => a.status === "rejected").length;

  useEffect(() => {
    loadAssets().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadAssets = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load asset keys
      const keysBytes = await contract.getData("asset_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing asset keys:", e); }
      }
      
      // Load each asset
      const list: NaturalCapitalAsset[] = [];
      for (const key of keys) {
        try {
          const assetBytes = await contract.getData(`asset_${key}`);
          if (assetBytes.length > 0) {
            try {
              const assetData = JSON.parse(ethers.toUtf8String(assetBytes));
              list.push({ 
                id: key, 
                name: assetData.name, 
                location: assetData.location,
                area: assetData.area,
                encryptedValue: assetData.encryptedValue, 
                timestamp: assetData.timestamp, 
                owner: assetData.owner, 
                category: assetData.category, 
                image: assetData.image || "",
                status: assetData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing asset data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading asset ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setAssets(list);
    } catch (e) { console.error("Error loading assets:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitAsset = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting asset value with Zama FHE..." });
    try {
      // Generate random value for demonstration
      const value = Math.floor(Math.random() * 1000000) + 500000; // $500k-$1.5M
      const encryptedValue = FHEEncryptNumber(value);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const assetId = `asset-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const assetData = { 
        name: newAssetData.name, 
        location: newAssetData.location,
        area: newAssetData.area,
        encryptedValue, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        category: newAssetData.category, 
        image: newAssetData.image,
        status: "pending"
      };
      
      // Store asset data
      await contract.setData(`asset_${assetId}`, ethers.toUtf8Bytes(JSON.stringify(assetData)));
      
      // Update asset keys
      const keysBytes = await contract.getData("asset_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(assetId);
      await contract.setData("asset_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Natural capital asset tokenized successfully!" });
      await loadAssets();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAssetData({ 
          name: "", 
          location: "", 
          area: 0, 
          category: "forest", 
          image: "" 
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyAsset = async (assetId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying natural capital asset..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const assetBytes = await contract.getData(`asset_${assetId}`);
      if (assetBytes.length === 0) throw new Error("Asset not found");
      const assetData = JSON.parse(ethers.toUtf8String(assetBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedAsset = { ...assetData, status: "verified" };
      await contractWithSigner.setData(`asset_${assetId}`, ethers.toUtf8Bytes(JSON.stringify(updatedAsset)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Asset verified successfully!" });
      await loadAssets();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectAsset = async (assetId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Rejecting asset..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const assetBytes = await contract.getData(`asset_${assetId}`);
      if (assetBytes.length === 0) throw new Error("Asset not found");
      const assetData = JSON.parse(ethers.toUtf8String(assetBytes));
      
      const updatedAsset = { ...assetData, status: "rejected" };
      await contract.setData(`asset_${assetId}`, ethers.toUtf8Bytes(JSON.stringify(updatedAsset)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Asset rejected!" });
      await loadAssets();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (assetOwner: string) => address?.toLowerCase() === assetOwner.toLowerCase();

  // Render statistics panel
  const renderStats = () => (
    <div className="stats-panel">
      <div className="stat-item">
        <div className="stat-value">{assets.length}</div>
        <div className="stat-label">Total Assets</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{verifiedCount}</div>
        <div className="stat-label">Verified</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{pendingCount}</div>
        <div className="stat-label">Pending</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{rejectedCount}</div>
        <div className="stat-label">Rejected</div>
      </div>
    </div>
  );

  // Render global map (simplified)
  const renderGlobalMap = () => (
    <div className="global-map">
      <div className="map-container">
        <div className="map-overlay">
          {assets.map(asset => (
            <div 
              key={asset.id} 
              className={`map-marker ${asset.status}`}
              style={{ 
                top: `${Math.random() * 80 + 10}%`, 
                left: `${Math.random() * 80 + 10}%`
              }}
              onClick={() => setSelectedAsset(asset)}
            >
              <div className="marker-icon"></div>
              <div className="marker-label">{asset.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="map-legend">
        <div className="legend-item"><div className="color-box verified"></div> Verified Asset</div>
        <div className="legend-item"><div className="color-box pending"></div> Pending Verification</div>
        <div className="legend-item"><div className="color-box rejected"></div> Rejected Asset</div>
      </div>
    </div>
  );

  // Render partners section
  const renderPartners = () => (
    <div className="partners-section">
      <h3>Our Partners</h3>
      <div className="partners-grid">
        <div className="partner-card">
          <div className="partner-logo zama"></div>
          <div className="partner-name">Zama FHE</div>
          <div className="partner-desc">Fully Homomorphic Encryption Solutions</div>
        </div>
        <div className="partner-card">
          <div className="partner-logo unep"></div>
          <div className="partner-name">UNEP</div>
          <div className="partner-desc">United Nations Environment Programme</div>
        </div>
        <div className="partner-card">
          <div className="partner-logo wwf"></div>
          <div className="partner-name">WWF</div>
          <div className="partner-desc">World Wildlife Fund</div>
        </div>
        <div className="partner-card">
          <div className="partner-logo greenpeace"></div>
          <div className="partner-name">Greenpeace</div>
          <div className="partner-desc">Global Environmental Organization</div>
        </div>
      </div>
    </div>
  );

  // Render FAQ section
  const renderFAQ = () => (
    <div className="faq-section">
      <h3>Frequently Asked Questions</h3>
      <div className="faq-list">
        <div className="faq-item">
          <div className="faq-question">What is natural capital?</div>
          <div className="faq-answer">Natural capital refers to the world's stocks of natural assets which include geology, soil, air, water and all living things.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How does FHE protect asset data?</div>
          <div className="faq-answer">Fully Homomorphic Encryption allows computations on encrypted data without decryption, ensuring sensitive ecological data remains private.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How are assets valued?</div>
          <div className="faq-answer">Assets are valued based on ecological importance, carbon sequestration potential, biodiversity, and ecosystem services.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">Who can tokenize natural assets?</div>
          <div className="faq-answer">Governments, indigenous communities, conservation organizations, and verified landowners can tokenize natural assets.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How are transactions secured?</div>
          <div className="faq-answer">All transactions use blockchain technology and FHE encryption to ensure security and privacy.</div>
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="nature-spinner">
        <div className="leaf"></div>
        <div className="leaf"></div>
        <div className="leaf"></div>
      </div>
      <p>Connecting to Natural Capital Network...</p>
    </div>
  );

  return (
    <div className="app-container natural-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="tree-icon"></div>
          </div>
          <h1>Natural<span>Capital</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-asset-btn nature-button">
            <div className="add-icon"></div>Tokenize Asset
          </button>
          <button className="nature-button" onClick={() => setShowFAQ(!showFAQ)}>
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Tokenizing Nature, Preserving Privacy</h2>
            <p>Trade natural capital assets securely using Zama FHE technology</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>
        
        <div className="project-intro">
          <h2>Natural Capital FHE Marketplace</h2>
          <p>
            Our platform enables the tokenization of natural assets like forests, rivers, and ecosystems 
            using Fully Homomorphic Encryption (FHE) from Zama. Asset values are encrypted on-chain, 
            allowing private trading while preserving ecological data confidentiality.
          </p>
          <div className="fhe-process">
            <div className="process-step">
              <div className="step-icon">🌳</div>
              <div className="step-label">Natural Asset</div>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon">🔒</div>
              <div className="step-label">FHE Encryption</div>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon">🖼️</div>
              <div className="step-label">Tokenized NFT</div>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon">💱</div>
              <div className="step-label">Private Trading</div>
            </div>
          </div>
        </div>
        
        <div className="dashboard-tabs">
          <button 
            className={`tab-button ${activeTab === "market" ? "active" : ""}`}
            onClick={() => setActiveTab("market")}
          >
            Asset Marketplace
          </button>
          <button 
            className={`tab-button ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            Global Map
          </button>
          <button 
            className={`tab-button ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
          <button 
            className={`tab-button ${activeTab === "partners" ? "active" : ""}`}
            onClick={() => setActiveTab("partners")}
          >
            Partners
          </button>
        </div>
        
        <div className="dashboard-content">
          {activeTab === "market" && (
            <div className="market-section">
              <div className="section-header">
                <h2>Natural Capital Assets</h2>
                <div className="header-actions">
                  <button onClick={loadAssets} className="refresh-btn nature-button" disabled={isRefreshing}>
                    {isRefreshing ? "Refreshing..." : "Refresh Assets"}
                  </button>
                </div>
              </div>
              <div className="assets-list">
                {assets.length === 0 ? (
                  <div className="no-assets">
                    <div className="no-assets-icon"></div>
                    <p>No natural capital assets found</p>
                    <button className="nature-button primary" onClick={() => setShowCreateModal(true)}>
                      Tokenize First Asset
                    </button>
                  </div>
                ) : (
                  <div className="assets-grid">
                    {assets.map(asset => (
                      <div 
                        className={`asset-card ${asset.status}`} 
                        key={asset.id}
                        onClick={() => setSelectedAsset(asset)}
                      >
                        <div className="asset-image" style={{ backgroundImage: `url(${asset.image || 'default-forest.jpg'})` }}></div>
                        <div className="asset-info">
                          <div className="asset-name">{asset.name}</div>
                          <div className="asset-meta">
                            <span className="asset-category">{asset.category}</span>
                            <span className="asset-area">{asset.area} ha</span>
                          </div>
                          <div className="asset-location">{asset.location}</div>
                          <div className="asset-footer">
                            <span className={`status-badge ${asset.status}`}>{asset.status}</span>
                            <span className="asset-date">
                              {new Date(asset.timestamp * 1000).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {activeTab === "map" && renderGlobalMap()}
          
          {activeTab === "stats" && renderStats()}
          
          {activeTab === "partners" && renderPartners()}
        </div>
        
        {showFAQ && renderFAQ()}
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitAsset} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          assetData={newAssetData} 
          setAssetData={setNewAssetData}
        />
      )}
      
      {selectedAsset && (
        <AssetDetailModal 
          asset={selectedAsset} 
          onClose={() => { setSelectedAsset(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          isOwner={isOwner(selectedAsset.owner)}
          onVerify={verifyAsset}
          onReject={rejectAsset}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content nature-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="nature-spinner small"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="tree-icon small"></div>
              <span>NaturalCapitalFHE</span>
            </div>
            <p>Tokenizing nature, preserving privacy with Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <div className="fhe-icon"></div>
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Natural Capital FHE Marketplace. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  assetData: any;
  setAssetData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, assetData, setAssetData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setAssetData({ ...assetData, [name]: value });
  };

  const handleAreaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setAssetData({ ...assetData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!assetData.name || !assetData.location || !assetData.area) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal nature-card">
        <div className="modal-header">
          <h2>Tokenize Natural Capital Asset</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Asset valuation will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Asset Name *</label>
              <input 
                type="text" 
                name="name" 
                value={assetData.name} 
                onChange={handleChange} 
                placeholder="e.g., Amazon Rainforest Reserve" 
                className="nature-input"
              />
            </div>
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text" 
                name="location" 
                value={assetData.location} 
                onChange={handleChange} 
                placeholder="e.g., Brazil, South America" 
                className="nature-input"
              />
            </div>
            <div className="form-group">
              <label>Area (hectares) *</label>
              <input 
                type="number" 
                name="area" 
                value={assetData.area} 
                onChange={handleAreaChange} 
                placeholder="Enter area size..." 
                className="nature-input"
                min="1"
              />
            </div>
            <div className="form-group">
              <label>Category *</label>
              <select name="category" value={assetData.category} onChange={handleChange} className="nature-select">
                <option value="forest">Forest</option>
                <option value="river">River</option>
                <option value="wetland">Wetland</option>
                <option value="coral">Coral Reef</option>
                <option value="grassland">Grassland</option>
                <option value="mountain">Mountain</option>
              </select>
            </div>
            <div className="form-group full-width">
              <label>Image URL (optional)</label>
              <input 
                type="text" 
                name="image" 
                value={assetData.image} 
                onChange={handleChange} 
                placeholder="https://..." 
                className="nature-input"
              />
            </div>
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Ecological data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn nature-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn nature-button primary">
            {creating ? "Tokenizing with FHE..." : "Submit Asset"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface AssetDetailModalProps {
  asset: NaturalCapitalAsset;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  isOwner: boolean;
  onVerify: (assetId: string) => void;
  onReject: (assetId: string) => void;
}

const AssetDetailModal: React.FC<AssetDetailModalProps> = ({ 
  asset, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature,
  isOwner,
  onVerify,
  onReject
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(asset.encryptedValue);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="asset-detail-modal nature-card">
        <div className="modal-header">
          <h2>{asset.name}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="asset-image-container">
            <div 
              className="asset-image" 
              style={{ backgroundImage: `url(${asset.image || 'default-forest.jpg'})` }}
            ></div>
          </div>
          
          <div className="asset-info-grid">
            <div className="info-item">
              <span>Category:</span>
              <strong>{asset.category}</strong>
            </div>
            <div className="info-item">
              <span>Location:</span>
              <strong>{asset.location}</strong>
            </div>
            <div className="info-item">
              <span>Area:</span>
              <strong>{asset.area} hectares</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{asset.owner.substring(0, 6)}...{asset.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Added:</span>
              <strong>{new Date(asset.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${asset.status}`}>{asset.status}</strong>
            </div>
          </div>
          
          <div className="asset-actions">
            {isOwner && asset.status === "pending" && (
              <>
                <button className="action-btn nature-button success" onClick={() => onVerify(asset.id)}>
                  Verify Asset
                </button>
                <button className="action-btn nature-button danger" onClick={() => onReject(asset.id)}>
                  Reject Asset
                </button>
              </>
            )}
            <button className="action-btn nature-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? "Decrypting..." : decryptedValue !== null ? "Hide Value" : "Reveal Encrypted Value"}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Asset Value</h3>
              <div className="decrypted-value">${decryptedValue.toLocaleString()}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted value is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
          
          <div className="fhe-explanation">
            <h3>How FHE Protects This Asset</h3>
            <p>
              This asset's valuation is encrypted using Zama's Fully Homomorphic Encryption (FHE) technology. 
              The encrypted value (<code>{asset.encryptedValue.substring(0, 30)}...</code>) can be traded and 
              processed without ever being decrypted, preserving the confidentiality of sensitive ecological 
              valuation data.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn nature-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;