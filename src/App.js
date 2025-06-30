// app.js
// -------
import React, { useState, useEffect, useCallback, useRef } from 'react';
// Firebase imports are re-enabled for persistence
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, query, where } from 'firebase/firestore';

// --- Consolidated & Cleaned Firebase Initialization ---

// Log debug info immediately for easier troubleshooting
console.log("=== FIREBASE DEBUG INFO ===");
console.log("process.env.NODE_ENV:", process.env.NODE_ENV);
console.log("Raw REACT_APP_FIREBASE_CONFIG:", process.env.REACT_APP_FIREBASE_CONFIG);
console.log("Raw REACT_APP_GEMINI_API_KEY:", process.env.REACT_APP_GEMINI_API_KEY ? "SET" : "NOT SET");
console.log("Raw REACT_APP_APP_ID:", process.env.REACT_APP_APP_ID);
console.log("typeof REACT_APP_FIREBASE_CONFIG:", typeof process.env.REACT_APP_FIREBASE_CONFIG);
console.log("=== END DEBUG INFO ===");


// Safely parse the config from environment variables
let parsedFirebaseConfig = {};
try {
    const rawConfig = process.env.REACT_APP_FIREBASE_CONFIG;
    if (rawConfig && rawConfig !== '{}') {
        parsedFirebaseConfig = JSON.parse(rawConfig);
    } else {
        console.error("REACT_APP_FIREBASE_CONFIG is not set or is empty.");
    }
} catch (e) {
    console.error("Error parsing REACT_APP_FIREBASE_CONFIG:", e);
}

// Initialize Firebase services ONCE at the top level.
// Use null as a fallback so the app can render an error state gracefully.
let app = null;
let auth = null;
let db = null;

if (parsedFirebaseConfig.apiKey && parsedFirebaseConfig.projectId) {
    try {
        app = initializeApp(parsedFirebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("✅ Firebase initialized successfully.");
    } catch(e) {
        console.error("❌ Firebase initialization failed:", e);
    }
} else {
    console.error("❌ Firebase config is missing or incomplete. Firebase will not be available.");
}

// Get other necessary environment variables
const appId = process.env.REACT_APP_APP_ID || 'default-app-id';

// The main application component.
function App() {
    const [inputDocument, setInputDocument] = useState('');
    const [modelDocuments, setModelDocuments] = useState([]); // {id, text, type, userId}
    const [reviewedDocuments, setReviewedDocuments] = useState([]); // {id, documentContent, reviews, timestamp, status, userId}

    const [reviews, setReviews] = useState({
        security: '',
        integration: '',
        data: '',
        scalability: '',
        summary: ''
    });
    // New state to hold explicit PASS/FAIL status for each review, for visual feedback
    const [reviewStatuses, setReviewStatuses] = useState({
        security: 'pending', // 'pending', 'PASS', 'FAIL'
        integration: 'pending',
        data: 'pending',
        scalability: 'pending',
        summary: 'pending' // For the aggregation step's overall status
    });

    const [isLoading, setIsLoading] = useState(false);
    const [currentStage, setCurrentStage] = useState('');
    const [showModelUploadModal, setShowModelUploadModal] = useState(false);
    const [newModelDocContent, setNewModelDocContent] = useState('');
    const [newModelDocType, setNewModelDocType] = useState('general'); // e.g., 'security', 'integration'
    const [message, setMessage] = useState('');
    // userId and isAuthReady are now managed by Firebase Auth
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // Ref for the hidden file input
    const fileInputRef = useRef(null);

    // Initial load/setup - now with simplified Firebase Auth logic
    useEffect(() => {
        // Check if Firebase was initialized successfully
        if (!auth) {
            setMessage('Firebase is not configured. Please check your environment variables.');
            setIsAuthReady(true); // Mark as ready to show the error message and stop loading states
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                console.log("onAuthStateChanged: User signed in with UID:", user.uid);
            } else {
                console.log("onAuthStateChanged: No user signed in, attempting anonymous sign-in...");
                try {
                    await signInAnonymously(auth);
                    // onAuthStateChanged will fire again with the new anonymous user
                } catch (error) {
                    console.error("Anonymous sign-in failed:", error);
                    setMessage('Failed to sign in anonymously. Data persistence may not work.');
                    setUserId(crypto.randomUUID()); // Fallback to a random ID for this session
                }
            }
            setIsAuthReady(true); // Auth state has been determined
        });

        return () => unsubscribe(); // Cleanup auth listener on component unmount
    }, []); // Empty dependency array ensures this runs once on mount

    // Fetch model documents and reviewed documents when auth is ready
    useEffect(() => {
        const fetchDocuments = async () => {
            // Ensure db and userId are available
            if (isAuthReady && db && userId) {
                try {
                    // Fetch Model Documents
                    const modelCollectionRef = collection(db, `artifacts/${appId}/public/data/model_documents`);
                    const modelQuerySnapshot = await getDocs(modelCollectionRef);
                    const fetchedModelDocs = modelQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setModelDocuments(fetchedModelDocs);
                    console.log("Fetched model documents:", fetchedModelDocs.length, "documents.");

                    // Fetch Reviewed Documents
                    const reviewedCollectionRef = collection(db, `artifacts/${appId}/public/data/reviewed_documents`);
                    const reviewedQuerySnapshot = await getDocs(reviewedCollectionRef);
                    const fetchedReviewedDocs = reviewedQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setReviewedDocuments(fetchedReviewedDocs);
                    console.log("Fetched reviewed documents:", fetchedReviewedDocs.length, "documents.");

                } catch (error) {
                    console.error("Error fetching documents:", error);
                    if (error.code === 'permission-denied') {
                        setMessage('Permission denied to load documents. Ensure Firebase security rules allow read access for authenticated users to public collections.');
                    } else {
                        setMessage('Failed to load documents.');
                    }
                }
            }
        };

        fetchDocuments();
    }, [isAuthReady, userId]); // Re-fetch if userId or auth readiness changes

    // Gemini API call helper
    const callGemini = async (prompt, generationConfig = {}, expectsJson = false) => {
        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: expectsJson ? "application/json" : "text/plain",
                ...generationConfig
            }
        };

        const apiKey = process.env.REACT_APP_GEMINI_API_KEY || '';

        if (!apiKey) {
            console.error("Gemini API Key is missing. Please set REACT_APP_GEMINI_API_KEY.");
            setMessage("Gemini API Key is missing. Cannot perform reviews.");
            throw new Error("Gemini API Key is missing.");
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const textResponse = result.candidates[0].content.parts[0].text;
                if (expectsJson) {
                    try {
                        return JSON.parse(textResponse);
                    } catch (jsonError) {
                        console.error("Failed to parse JSON response:", textResponse, jsonError);
                        throw new Error("Invalid JSON response from LLM.");
                    }
                }
                return textResponse;
            } else {
                console.error("Unexpected Gemini API response structure:", result);
                throw new Error("Failed to get a valid response from Gemini API.");
            }
        } catch (error) {
            console.error("Error calling Gemini API:", error);
            throw error;
        }
    };

    // --- Agent Definitions ---

    const reviewerAgent = useCallback(async (agentName, specialization, docContent, modelDocs) => {
        // setCurrentStage(`Reviewing: ${specialization}`); // Removed to prevent UI flicker
        setMessage('');

        const relevantModelDocs = modelDocs.filter(doc => doc.type === specialization.toLowerCase() || doc.type === 'general');
        const modelDocText = relevantModelDocs.map(doc => `--- Model Document (Type: ${doc.type}) ---\n${doc.text}\n--------------------`).join('\n\n');

        const prompt = `
        You are an expert in ${specialization} within the field of system design.
        Your task is to review the following design document.
        Critique it specifically from a ${specialization} perspective.
        Consider general best practices and also compare it against the provided reference model documents.
        Identify potential issues, risks, compliance concerns (if applicable to ${specialization}), and areas for improvement.

        Based on your review, determine an overall status for this document from a ${specialization} perspective: "PASS" if it meets standards or has minor, addressable issues; "FAIL" if it has critical, show-stopping flaws that require major rework before further review.

        Respond ONLY with a JSON object containing two fields:
        1.  "status": A string, either "PASS" or "FAIL".
        2.  "feedback": A string containing your detailed review comments.

        --- Input Design Document ---
        ${docContent}
        ---------------------------

        ${modelDocText ? `--- Reference Model Documents ---
        ${modelDocText}
        ---------------------------` : 'No specific reference model documents provided for this review.'}

        Example of desired JSON output:
        \`\`\`json
        {
            "status": "PASS",
            "feedback": "This is the detailed review for the ${specialization} aspect. It identifies some minor points for improvement but no critical issues."
        }
        \`\`\`
        Or:
        \`\`\`json
        {
            "status": "FAIL",
            "feedback": "Critical Issue Found: The document has a major flaw in its ${specialization} design. This must be addressed immediately."
        }
        \`\`\`
        Your JSON response:
        `;

        try {
            // Expect JSON response
            const reviewObject = await callGemini(prompt, {}, true);
            // Basic validation for the expected structure
            if (reviewObject && typeof reviewObject.status === 'string' && typeof reviewObject.feedback === 'string') {
                return reviewObject;
            } else {
                console.error("Reviewer agent returned invalid JSON structure:", reviewObject);
                return { status: "FAIL", feedback: `Error: Reviewer returned invalid format. Original response: ${JSON.stringify(reviewObject)}` };
            }
        } catch (error) {
            console.error(`Error during ${specialization} review:`, error);
            setMessage(`Failed to complete ${specialization} review.`);
            return { status: "FAIL", feedback: `Error: Failed to complete ${specialization} review. ${error.message}` };
        }
    }, [callGemini]);

    const aggregatorAgent = useCallback(async (allReviews, docContent) => {
        setCurrentStage('Aggregating Feedback');
        setMessage('');

        // Extract feedback strings from structured review objects
        const reviewsText = Object.entries(allReviews)
            .filter(([, reviewObj]) => reviewObj && reviewObj.feedback) // Ensure feedback exists
            .map(([specialty, reviewObj]) => `--- ${specialty.charAt(0).toUpperCase() + specialty.slice(1)} Review (Status: ${reviewObj.status}) ---\n${reviewObj.feedback}`)
            .join('\n\n');

        const prompt = `
        You are an expert in consolidating technical reviews.
        Your task is to take the following individual reviews for a design document and provide a comprehensive summary.
        Identify common themes, highlight the most critical issues, note any conflicting feedback, and provide a final recommendation or verdict (e.g., "Ready for next stage", "Requires major revisions", "Rejected due to critical flaws").

        --- Original Design Document Snippet (for context) ---
        ${docContent.substring(0, 500)}...
        ----------------------------------------------------

        --- Individual Reviews ---
        ${reviewsText}
        --------------------------

        Provide the consolidated summary and final recommendation.
        `;

        try {
            const summary = await callGemini(prompt);
            return summary;
        } catch (error) {
            console.error("Error during aggregation:", error);
            setMessage('Failed to complete aggregation.');
            return `Error: Failed to complete aggregation. ${error.message}`;
        }
    }, [callGemini]);

    // --- Workflow Orchestration ---
    const startReviewWorkflow = async () => {
        if (!inputDocument.trim()) {
            setMessage('Please provide a design document to review.');
            return;
        }
        if (!isAuthReady || !db || !userId) {
            setMessage('Application not fully ready (Firebase not connected or authenticated). Please wait a moment.');
            return;
        }

        setIsLoading(true);
        setMessage('');
        setReviews({ security: '', integration: '', data: '', scalability: '', summary: '' });
        setReviewStatuses({ security: 'pending', integration: 'pending', data: 'pending', scalability: 'pending', summary: 'pending' });

        let currentStructuredReviews = { security: { status: '', feedback: '' }, integration: { status: '', feedback: '' }, data: { status: '', feedback: '' }, scalability: { status: '', feedback: '' } };
        let workflowFailed = false;

        try {
            const allModelDocs = modelDocuments;

            const reviewStages = [
                { id: 'security', specialization: 'Security' },
                { id: 'integration', specialization: 'Integration Pattern' },
                { id: 'data', specialization: 'Data' },
                { id: 'scalability', specialization: 'Scalability' }
            ];

            for (const stage of reviewStages) {
                const reviewResult = await reviewerAgent(stage.id, stage.specialization, inputDocument, allModelDocs);
                currentStructuredReviews = { ...currentStructuredReviews, [stage.id]: reviewResult };
                setReviews(prev => ({ ...prev, [stage.id]: reviewResult.feedback }));
                setReviewStatuses(prev => ({ ...prev, [stage.id]: reviewResult.status }));

                if (reviewResult.status === 'FAIL') {
                    workflowFailed = true;
                    break;
                }
            }

            if (workflowFailed) {
                setCurrentStage(`${currentStage} Failed`);
                setIsLoading(false);
                return;
            }

            const summaryResult = await aggregatorAgent(currentStructuredReviews, inputDocument);
            setReviews(prev => ({ ...prev, summary: summaryResult }));
            setReviewStatuses(prev => ({ ...prev, summary: 'PASS' }));
            setCurrentStage('Review Complete');

                        const passed = summaryResult.toLowerCase().includes("approved");
            if (passed) {
                setCurrentStage('Document Passed Review. Storing...');
                const reviewedDocsCollectionRef = collection(db, `artifacts/${appId}/public/data/reviewed_documents`);
                await setDoc(doc(reviewedDocsCollectionRef), {
                    documentContent: inputDocument,
                    reviews: { ...currentStructuredReviews, summary: summaryResult },
                    timestamp: new Date().toISOString(),
                    userId: userId,
                    status: 'passed'
                });
                setMessage('Document passed review and has been stored successfully in Firebase!');
            } else {
                setMessage('Document did not pass all reviews or requires major revisions. Not stored in Firebase.');
            }

        } catch (error) {
            console.error("Workflow error:", error);
            setMessage(`An error occurred during the review workflow: ${error.message}`);
        } finally {
            setIsLoading(false);
            setCurrentStage('');
        }
    };

    // Handler for file selection
    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            setMessage('');
            const reader = new FileReader();
            reader.onload = (e) => {
                setNewModelDocContent(e.target.result);
                setMessage(`File "${file.name}" loaded into content area.`);
            };
            reader.onerror = (e) => {
                console.error("Error reading file:", e);
                setMessage(`Error reading file "${file.name}".`);
            };
            reader.readAsText(file);
        }
    };

    const triggerFileInput = () => {
        fileInputRef.current.click();
    };

    // --- Model Document Management ---
    const handleAddModelDocument = async () => {
        // --- START DEBUGGING ---
        console.clear(); // Clear the console to make the new logs easy to see
        console.log("--- 1. 'Add Model Document' button clicked! ---");
        console.log("Is Auth Ready?:", isAuthReady);
        console.log("Is DB object available?:", !!db); // The '!!' converts the object to a true/false for a clear log
        console.log("Current User ID:", userId);
        console.log("Content to add:", `'${newModelDocContent}'`);
        // --- END DEBUGGING ---

        if (!newModelDocContent.trim()) {
            setMessage('Model document content cannot be empty.');
            console.log("--- EXIT: Content is empty. ---");
            return;
        }
        
        // This is the most important check
        if (!isAuthReady || !db || !userId) {
            setMessage('Firebase not connected or authenticated. Please wait before adding model docs.');
            console.log("--- EXIT: Auth/DB not ready or no User ID. ---");
            return;
        }

        console.log("--- 2. All checks passed. Attempting to write to Firebase... ---");
        try {
            // Add to Firebase Firestore
            const modelDocsCollectionRef = collection(db, `artifacts/${appId}/public/data/model_documents`);
            const newDocRef = doc(modelDocsCollectionRef); // Firestore generates unique ID
            await setDoc(newDocRef, {
                text: newModelDocContent,
                type: newModelDocType,
                timestamp: new Date().toISOString(),
                userId: userId // Storing userId of the uploader
            });
            console.log("--- 3. SUCCESS: Wrote document to Firebase. ---");
            
            // Update local state by fetching from Firestore (to ensure sync)
            const modelQuerySnapshot = await getDocs(modelDocsCollectionRef);
            const fetchedModelDocs = modelQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setModelDocuments(fetchedModelDocs);

            setNewModelDocContent(''); // Clear content after adding
            setShowModelUploadModal(false);
            setMessage('Model document added successfully to Firebase!');
        } catch (error) {
            console.error("--- 4. ERROR: An error occurred during the Firebase write operation. ---");
            console.error("The error object is:", error);
            if (error.code === 'permission-denied') {
                setMessage('Permission denied to add model document. Check your Firestore rules for write permissions.');
            } else {
                setMessage('Failed to add model document.');
            }
        }
    };

    const handleDeleteModelDocument = async (docId) => {
        if (!isAuthReady || !db || !userId) {
            setMessage('Firebase not connected or authenticated. Cannot delete model docs.');
            return;
        }
        try {
            const docRef = doc(db, `artifacts/${appId}/public/data/model_documents`, docId);
            await deleteDoc(docRef);
            const modelDocsCollectionRef = collection(db, `artifacts/${appId}/public/data/model_documents`);
            const modelQuerySnapshot = await getDocs(modelDocsCollectionRef);
            const fetchedModelDocs = modelQuerySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setModelDocuments(fetchedModelDocs);

            setMessage('Model document deleted successfully from Firebase!');
        } catch (error) {
            console.error("Error deleting model document:", error);
            setMessage(error.code === 'permission-denied' ? 'Permission denied to delete model document.' : 'Failed to delete model document.');
        }
    };


    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans antialiased">
            <style>
                {`
                body {
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
                }
                }
                .glow-button {
                    transition: all 0.3s ease;
                }
                .glow-button:hover {
                    box-shadow: 0 0 10px rgba(79, 70, 229, 0.6), 0 0 20px rgba(79, 70, 229, 0.4);
                    transform: translateY(-2px);
                }
                .panel-glow {
                    transition: all 0.3s ease-in-out;
                    border: 2px solid transparent;
                }
                .panel-glow.active {
                    box-shadow: 0 0 15px rgba(34, 197, 94, 0.6), 0 0 30px rgba(34, 197, 94, 0.4);
                    border-color: #22c55e;
                }
                .panel-glow.failed {
                    box-shadow: 0 0 15px rgba(239, 68, 68, 0.6), 0 0 30px rgba(239, 68, 68, 0.4);
                    border-color: #ef4444;
                }
                `}
            </style>
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-6xl space-y-8 border-t-4 border-indigo-500">
                <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-6 leading-tight">
                    Multi-Agent Design Document Review
                </h1>

                {userId && (
                    <div className="text-sm text-center text-gray-600 mb-4">
                        Logged in as: <span className="font-mono bg-gray-200 px-2 py-1 rounded text-xs">{userId}</span>
                    </div>
                )}
                {!userId && isAuthReady && (
                     <div className="text-sm text-center text-red-600 mb-4">
                        Authenticating... Please wait.
                    </div>
                )}
                 {!isAuthReady && (
                     <div className="text-sm text-center text-gray-600 mb-4">
                        Initializing app...
                    </div>
                )}

                {message && (
                    <div className={`p-3 rounded-lg ${message.toLowerCase().includes('error') || message.toLowerCase().includes('failed') || message.toLowerCase().includes('halted') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'} text-center mb-4`}>
                        {message}
                    </div>
                )}

                <div className="bg-gray-50 p-6 rounded-xl shadow-inner border border-gray-200">
                    <h2 className="text-2xl font-semibold text-gray-800 mb-4">Your Design Document</h2>
                    <textarea
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none h-48 resize-y text-gray-700"
                        placeholder="Paste your design document here for review..."
                        value={inputDocument}
                        onChange={(e) => setInputDocument(e.target.value)}
                        disabled={isLoading}
                    ></textarea>
                    <div className="flex justify-center mt-6 space-x-4">
                        <button
                            onClick={startReviewWorkflow}
                            disabled={isLoading || !isAuthReady || !userId}
                            className="glow-button bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out shadow-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    {currentStage || 'Processing...'}
                                </>
                            ) : (
                                'Start Review'
                            )}
                        </button>
                        <button
                            onClick={() => setShowModelUploadModal(true)}
                            className="glow-button bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out shadow-lg"
                        >
                            Manage Model Documents
                        </button>
                    </div>
                </div>

                <div className="space-y-6">
                    <h2 className="text-2xl font-semibold text-gray-800 mb-4 text-center">Review Feedback</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {['Security', 'Integration', 'Data', 'Scalability'].map((specialty) => (
                            <div
                                key={specialty}
                                className={`bg-white p-6 rounded-xl shadow-md border-2 border-gray-200 panel-glow
                                ${isLoading && !reviews.summary ? 'active' : ''}
                                ${reviewStatuses[specialty.toLowerCase()] === 'FAIL' ? 'failed' : ''}
                                `}
                            >
                                <h3 className="text-xl font-semibold text-gray-700 mb-3 flex items-center">
                                    <span className="mr-2 text-indigo-500">
                                        {specialty === 'Security' && '🔒'}
                                        {specialty === 'Integration' && '🔗'}
                                        {specialty === 'Data' && '📊'}
                                        {specialty === 'Scalability' && '📈'}
                                    </span>
                                    {specialty} Review
                                </h3>
                                <div className="min-h-[100px] max-h-[300px] overflow-y-auto text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    {reviews[specialty.toLowerCase()] || 'Awaiting review...'}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className={`bg-white p-6 rounded-xl shadow-lg border-2 border-gray-200 panel-glow ${currentStage.includes('Aggregating') || currentStage.includes('Complete') ? 'active' : ''}`}>
                        <h3 className="text-2xl font-bold text-gray-800 mb-4 flex items-center justify-center">
                            <span className="mr-3 text-green-600">✨</span>
                            Final Review Summary
                        </h3>
                        <div className="min-h-[150px] max-h-[400px] overflow-y-auto text-gray-700 bg-gray-50 p-4 rounded-lg border border-gray-100 leading-relaxed whitespace-pre-wrap">
                            {reviews.summary || 'Awaiting final summary...'}
                        </div>
                    </div>
                </div>

                {showModelUploadModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-2xl relative">
                            <button
                                onClick={() => setShowModelUploadModal(false)}
                                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-3xl font-semibold"
                            >
                                ×
                            </button>
                            <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Manage Model Documents</h2>

                            <div className="mb-6">
                                <label htmlFor="model-doc-content" className="block text-gray-700 text-sm font-semibold mb-2">
                                    New Model Document Content (Paste or Upload):
                                </label>
                                <textarea
                                    id="model-doc-content"
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none h-32 resize-y text-gray-700"
                                    placeholder="Paste content for a model document here..."
                                    value={newModelDocContent}
                                    onChange={(e) => setNewModelDocContent(e.target.value)}
                                ></textarea>
                                <div className="flex items-center gap-4 mt-4">
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        className="hidden"
                                        accept=".txt,.md,.json,.js,.css,.html,.xml"
                                    />
                                    <button
                                        onClick={triggerFileInput}
                                        className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 px-4 rounded-xl transition duration-300 ease-in-out shadow-sm border border-gray-300 flex items-center justify-center"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                        Upload Text File
                                    </button>
                                </div>


                                <label htmlFor="model-doc-type" className="block text-gray-700 text-sm font-semibold mt-4 mb-2">
                                    Document Type (for specific reviewers):
                                </label>
                                <select
                                    id="model-doc-type"
                                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-gray-700 bg-white"
                                    value={newModelDocType}
                                    onChange={(e) => setNewModelDocType(e.target.value)}
                                >
                                    <option value="general">General (all agents)</option>
                                    <option value="security">Security</option>
                                    <option value="integration pattern">Integration Pattern</option>
                                    <option value="data">Data</option>
                                    <option value="scalability">Scalability</option>
                                </select>
                                <button
                                    onClick={handleAddModelDocument}
                                    disabled={!isAuthReady || !userId}
                                    className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Add Model Document
                                </button>
                            </div>

                            <h3 className="text-xl font-bold text-gray-800 mb-4">Existing Model Documents</h3>
                            {modelDocuments.length === 0 ? (
                                <p className="text-gray-500 text-center">No model documents added yet.</p>
                            ) : (
                                <div className="space-y-4 max-h-80 overflow-y-auto border border-gray-200 p-4 rounded-lg bg-gray-50">
                                    {modelDocuments.map((docItem) => (
                                        <div key={docItem.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex justify-between items-start">
                                            <div>
                                                <p className="font-medium text-gray-800 text-base">{docItem.text.substring(0, 100)}...</p>
                                                <p className="text-sm text-gray-500 mt-1">Type: {docItem.type.charAt(0).toUpperCase() + docItem.type.slice(1)}</p>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteModelDocument(docItem.id)}
                                                className="ml-4 text-red-500 hover:text-red-700 transition duration-200"
                                                title="Delete Model Document"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <h3 className="text-xl font-bold text-gray-800 mt-6 mb-4">Passed Reviews</h3>
                            {reviewedDocuments.length === 0 ? (
                                <p className="text-gray-500 text-center">No documents passed review yet.</p>
                            ) : (
                                <div className="space-y-4 max-h-80 overflow-y-auto border border-gray-200 p-4 rounded-lg bg-gray-50">
                                    {reviewedDocuments.map((docItem) => (
                                        <div key={docItem.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                                            <p className="font-medium text-gray-800 text-base">Original Doc (excerpt): {docItem.documentContent.substring(0, 100)}...</p>
                                            <p className="text-sm text-gray-500 mt-1">Status: <span className="font-semibold text-green-600">{docItem.status}</span></p>
                                            <p className="text-sm text-gray-500">Reviewed At: {new Date(docItem.timestamp).toLocaleString()}</p>
                                            <details className="mt-2 text-sm text-gray-600">
                                                <summary className="cursor-pointer font-semibold text-indigo-700">View Full Review Details</summary>
                                                <pre className="mt-2 p-2 bg-gray-100 rounded-lg overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify(docItem.reviews, null, 2)}</pre>
                                            </details>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;