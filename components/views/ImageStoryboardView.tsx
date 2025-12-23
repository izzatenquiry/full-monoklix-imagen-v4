
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import ImageUpload from '../common/ImageUpload';
import { type MultimodalContent, generateMultimodalContent } from '../../services/geminiService';
import { addHistoryItem } from '../../services/historyService';
import Spinner from '../common/Spinner';
import { DownloadIcon, ImageIcon, WandIcon, AlertTriangleIcon, UsersIcon } from '../Icons';
import { getProductReviewImagePrompt, getProductReviewStoryboardPrompt, getImageEditingPrompt } from '../../services/promptManager';
import { type User, type Language } from '../../types';
import { incrementImageUsage } from '../../services/userService';
import { handleApiError } from '../../services/errorHandler';
import { editOrComposeWithImagen } from '../../services/imagenV3Service';
import CreativeDirectionPanel from '../common/CreativeDirectionPanel';
import { getInitialCreativeDirectionState, type CreativeDirectionState } from '../../services/creativeDirectionService';
import PreviewModal from '../common/PreviewModal';

const contentTypeOptions = ["None", "Random", "Hard Selling", "Soft Selling", "Storytelling", "Problem/Solution", "ASMR / Sensory", "Unboxing", "Educational", "Testimonial"];
const languages = ["English", "Bahasa Malaysia", "Chinese"];

interface ImageEditPreset {
  base64: string;
  mimeType: string;
}

interface ImageStoryboardViewProps {
  onReEdit: (preset: ImageEditPreset) => void;
  currentUser: User;
  onUserUpdate: (user: User) => void;
  language: Language;
}

const downloadText = (text: string, fileName: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const SESSION_KEY = 'imageStoryboardState';

const ImageStoryboardView: React.FC<ImageStoryboardViewProps> = ({ onReEdit, currentUser, onUserUpdate, language }) => {
  const [productImage, setProductImage] = useState<MultimodalContent | null>(null);
  const [faceImage, setFaceImage] = useState<MultimodalContent | null>(null);
  const [productDesc, setProductDesc] = useState('');
  const [selectedContentType, setSelectedContentType] = useState<string>(contentTypeOptions[0]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("English");
  const [storyboard, setStoryboard] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [includeCaptions, setIncludeCaptions] = useState<'Yes' | 'No'>('No');
  const [includeVoiceover, setIncludeVoiceover] = useState<'Yes' | 'No'>('Yes');
  const [includeModel, setIncludeModel] = useState<'No' | 'Yes'>('No');

  // State for multi-image generation
  const [parsedScenes, setParsedScenes] = useState<string[]>([]);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imageLoadingStatus, setImageLoadingStatus] = useState<boolean[]>(Array(4).fill(false));
  const [generatedImages, setGeneratedImages] = useState<(string | null)[]>(Array(4).fill(null));
  const [imageGenerationErrors, setImageGenerationErrors] = useState<(string | null)[]>(Array(4).fill(null));
  const [previewingSceneIndex, setPreviewingSceneIndex] = useState<number | null>(null);

  // New state for inline editing
  const [editingSceneIndex, setEditingSceneIndex] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  const [productImageUploadKey, setProductImageUploadKey] = useState(Date.now());
  const [faceImageUploadKey, setFaceImageUploadKey] = useState(Date.now() + 1);

  // New creative direction states
  const [creativeState, setCreativeState] = useState<CreativeDirectionState>(getInitialCreativeDirectionState());

  // Image aspect ratio state
  const [imageAspectRatio, setImageAspectRatio] = useState('9:16');

  useEffect(() => {
    try {
        const savedState = sessionStorage.getItem(SESSION_KEY);
        if (savedState) {
            const state = JSON.parse(savedState);
            if (state.productDesc) setProductDesc(state.productDesc);
            if (state.selectedContentType) setSelectedContentType(state.selectedContentType);
            if (state.selectedLanguage) setSelectedLanguage(state.selectedLanguage);
            if (state.storyboard) setStoryboard(state.storyboard);
            if (state.includeCaptions) setIncludeCaptions(state.includeCaptions);
            if (state.includeVoiceover) setIncludeVoiceover(state.includeVoiceover);
            if (state.includeModel) setIncludeModel(state.includeModel);
            if (state.parsedScenes) setParsedScenes(state.parsedScenes);
            if (state.creativeState) setCreativeState(state.creativeState);
            if (state.imageAspectRatio) setImageAspectRatio(state.imageAspectRatio);
        }
    } catch (e) { console.error("Failed to load state from session storage", e); }
  }, []);

  useEffect(() => {
    try {
        const stateToSave = { 
            productDesc,
            selectedContentType, selectedLanguage, storyboard, includeCaptions, includeVoiceover,
            includeModel,
            parsedScenes, 
            creativeState,
            imageAspectRatio
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(stateToSave));
    } catch (e) { console.error("Failed to save state to session storage", e); }
  }, [
    productDesc,
    selectedContentType, selectedLanguage, storyboard, includeCaptions, includeVoiceover,
    includeModel,
    parsedScenes, creativeState,
    imageAspectRatio
  ]);

  // Effect to re-parse scenes whenever the storyboard text is edited by the user.
  useEffect(() => {
    if (storyboard) {
      const sceneSplitRegex = /\*\*(?:Scene|Babak)\s+\d+:\s*\*\*/i;
      const parts = storyboard.split(sceneSplitRegex);
      const scenes = parts.length > 1 ? parts.slice(1).map(part => part.trim()) : [];
      setParsedScenes(scenes.slice(0, 4));
    }
  }, [storyboard]);

  const handleProductImageUpload = useCallback((base64: string, mimeType: string) => {
    setProductImage({ base64, mimeType });
  }, []);

  const handleFaceImageUpload = useCallback((base64: string, mimeType: string) => {
    setFaceImage({ base64, mimeType });
  }, []);

  const handleRemoveProductImage = useCallback(() => {
    setProductImage(null);
  }, []);

  const handleRemoveFaceImage = useCallback(() => {
    setFaceImage(null);
  }, []);

  const handleGenerate = async () => {
    if ((includeModel === 'No' && !productImage) || (includeModel === 'Yes' && (!faceImage || !productImage)) || !productDesc) {
      setStoryboardError("Please upload the required images and provide a product description.");
      return;
    }
    setIsLoading(true);
    setStoryboardError(null);
    setStoryboard(null);
    setParsedScenes([]);
    setGeneratedImages(Array(4).fill(null));
    setImageGenerationErrors(Array(4).fill(null));

    const prompt = getProductReviewStoryboardPrompt({
      productDesc,
      selectedLanguage,
      selectedContentType,
      includeCaptions,
      includeVoiceover,
      includeModel,
      creativeDirection: creativeState
    });

    try {
      const imagesPayload: MultimodalContent[] = [productImage!];
      if (includeModel === 'Yes' && faceImage) {
        imagesPayload.push(faceImage);
      }
      
      const result = await generateMultimodalContent(prompt, imagesPayload);
      setStoryboard(result); // This will trigger the useEffect to parse scenes

      await addHistoryItem({
        type: 'Storyboard',
        prompt: `Product Review: ${productDesc.substring(0, 50)}...`,
        result: result,
      });
      
    } catch (e) {
      const userFriendlyMessage = handleApiError(e);
      setStoryboardError(userFriendlyMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSceneChange = (index: number, newText: string) => {
    if (storyboard) {
        const updatedScenes = [...parsedScenes];
        updatedScenes[index] = newText;

        const isMalay = selectedLanguage === 'Bahasa Malaysia';
        const sceneTitle = isMalay ? 'Babak' : 'Scene';
        
        const titles = storyboard?.match(/\*\*(?:Scene|Babak)\s+\d+:.*?\*\*/gi) || [];
        
        const newStoryboardString = updatedScenes.map((content, i) => {
            const title = titles[i] || `**${sceneTitle} ${i + 1}:**`;
            return `${title}\n${content}`;
        }).join('\n\n');

        setStoryboard(newStoryboardString);
    }
  };

    const generateSceneImage = async (index: number) => {
        if (!productImage || !parsedScenes[index]) return;

        setImageLoadingStatus(prev => {
            const newStatus = [...prev];
            newStatus[index] = true;
            return newStatus;
        });
        setImageGenerationErrors(prev => {
            const newErrors = [...prev];
            newErrors[index] = null;
            return newErrors;
        });

        try {
            const prompt = getProductReviewImagePrompt({
                productDesc,
                sceneDescription: parsedScenes[index],
                includeModel,
                creativeDirection: creativeState
            });
            
            const imagesToCompose: { base64: string, mimeType: string, category: string, caption: string }[] = [{ ...productImage, category: 'MEDIA_CATEGORY_SUBJECT', caption: 'product' }];
            if (includeModel === 'Yes' && faceImage) {
              imagesToCompose.push({ ...faceImage, category: 'MEDIA_CATEGORY_SUBJECT', caption: 'model face' });
            }

            const result = await editOrComposeWithImagen({
                prompt,
                images: imagesToCompose,
                config: { aspectRatio: imageAspectRatio as '1:1' | '9:16' | '16:9' }
            });
            const imageBase64 = result.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;

            if (!imageBase64) {
                throw new Error("The AI did not return an image. Please try a different prompt.");
            }
            
            await addHistoryItem({ type: 'Image', prompt: `Storyboard Scene ${index + 1}: ${parsedScenes[index].substring(0, 50)}...`, result: imageBase64 });

            const updateResult = await incrementImageUsage(currentUser);
            if (updateResult.success && updateResult.user) {
                onUserUpdate(updateResult.user);
            }

            setGeneratedImages(prev => {
                const newImages = [...prev];
                newImages[index] = imageBase64;
                return newImages;
            });
        } catch (e) {
            const userFriendlyMessage = handleApiError(e);
            setImageGenerationErrors(prev => {
                const newErrors = [...prev];
                newErrors[index] = userFriendlyMessage;
                return newErrors;
            });
        } finally {
            setImageLoadingStatus(prev => {
                const newStatus = [...prev];
                newStatus[index] = false;
                return newStatus;
            });
        }
    };

  const handleRetryScene = (index: number) => generateSceneImage(index);

  const handleEditScene = async (index: number) => {
    const baseImage = generatedImages[index];
    if (!baseImage || typeof baseImage !== 'string' || !editPrompt.trim()) return;

    setImageLoadingStatus(prev => {
        const newStatus = [...prev];
        newStatus[index] = true;
        return newStatus;
    });
    setImageGenerationErrors(prev => {
        const newErrors = [...prev];
        newErrors[index] = null;
        return newErrors;
    });

    const prompt = getImageEditingPrompt(editPrompt);
    
    try {
        const result = await editOrComposeWithImagen({
            prompt,
            images: [{ 
                base64: baseImage, 
                mimeType: 'image/png', 
                category: 'MEDIA_CATEGORY_SUBJECT', 
                caption: 'image to edit' 
            }],
            config: { aspectRatio: imageAspectRatio as '1:1' | '9:16' | '16:9' }
        });
        const imageBase64 = result.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;

        if (!imageBase64) {
            throw new Error("The AI did not return an edited image. Please try a different prompt.");
        }
        
        await addHistoryItem({ type: 'Image', prompt: `Edited Storyboard Scene ${index + 1}: ${editPrompt}`, result: imageBase64 });

        const updateResult = await incrementImageUsage(currentUser);
        if (updateResult.success && updateResult.user) {
            onUserUpdate(updateResult.user);
        }

        setGeneratedImages(prev => {
            const newImages = [...prev];
            newImages[index] = imageBase64;
            return newImages;
        });

        setEditingSceneIndex(null);
        setEditPrompt('');

    } catch (e) {
        const userFriendlyMessage = handleApiError(e);
        setImageGenerationErrors(prev => {
            const newErrors = [...prev];
            newErrors[index] = userFriendlyMessage;
            return newErrors;
        });
    } finally {
        setImageLoadingStatus(prev => {
            const newStatus = [...prev];
            newStatus[index] = false;
            return newStatus;
        });
    }
  };

  const handleGenerateAllImages = async () => {
    setIsGeneratingImages(true);
    
    const promises = [];
    for (let i = 0; i < 4; i++) {
        if (parsedScenes[i]) {
            promises.push(new Promise<void>(resolve => {
                setTimeout(async () => {
                    await generateSceneImage(i);
                    resolve();
                }, i * 500);
            }));
        }
    }
    
    await Promise.all(promises);
    setIsGeneratingImages(false);
  };

  const handleReset = useCallback(() => {
    setProductImage(null);
    setFaceImage(null);
    setProductDesc('');
    setSelectedContentType(contentTypeOptions[0]);
    setSelectedLanguage("English");
    setStoryboard(null);
    setStoryboardError(null);
    setIncludeCaptions('No');
    setIncludeVoiceover('Yes');
    setIncludeModel('No');
    setParsedScenes([]);
    setIsGeneratingImages(false);
    setGeneratedImages(Array(4).fill(null));
    setImageGenerationErrors(Array(4).fill(null));
    setProductImageUploadKey(Date.now());
    setFaceImageUploadKey(Date.now() + 1);
    setCreativeState(getInitialCreativeDirectionState());
    setImageAspectRatio('9:16');
    
    sessionStorage.removeItem(SESSION_KEY);
  }, []);
  
  const step2Disabled = parsedScenes.length === 0;
  
  // Logic for Preview Modal
    const validGeneratedImages = useMemo(() => 
        generatedImages
            .map((img, index) => ({ img, index }))
            .filter((item): item is { img: string; index: number } => typeof item.img === 'string'),
        [generatedImages]
    );

    const currentPreviewItemInFilteredList = useMemo(() => {
        if (previewingSceneIndex === null) return null;
        const index = validGeneratedImages.findIndex(item => item.index === previewingSceneIndex);
        return index !== -1 ? { item: validGeneratedImages[index], filteredIndex: index } : null;
    }, [previewingSceneIndex, validGeneratedImages]);

    const itemToPreview = useMemo(() => {
        if (!currentPreviewItemInFilteredList) return null;
        
        return {
            id: `scene-${currentPreviewItemInFilteredList.item.index}`,
            type: 'Image' as const,
            prompt: parsedScenes[currentPreviewItemInFilteredList.item.index] || `Scene ${currentPreviewItemInFilteredList.item.index + 1}`,
            result: currentPreviewItemInFilteredList.item.img,
            timestamp: Date.now()
        };
    }, [currentPreviewItemInFilteredList, parsedScenes]);

    const handleNextPreview = () => {
        if (!currentPreviewItemInFilteredList) return;
        const { filteredIndex } = currentPreviewItemInFilteredList;
        if (filteredIndex < validGeneratedImages.length - 1) {
            setPreviewingSceneIndex(validGeneratedImages[filteredIndex + 1].index);
        }
    };
    const handlePreviousPreview = () => {
        if (!currentPreviewItemInFilteredList) return;
        const { filteredIndex } = currentPreviewItemInFilteredList;
        if (filteredIndex > 0) {
            setPreviewingSceneIndex(validGeneratedImages[filteredIndex - 1].index);
        }
    };

    const hasNextPreview = currentPreviewItemInFilteredList ? currentPreviewItemInFilteredList.filteredIndex < validGeneratedImages.length - 1 : false;
    const hasPreviousPreview = currentPreviewItemInFilteredList ? currentPreviewItemInFilteredList.filteredIndex > 0 : false;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold sm:text-3xl text-neutral-900 dark:text-white">AI Image Storyboard</h1>
        <p className="text-sm sm:text-base text-neutral-500 dark:text-neutral-400 mt-1">A powerful 2-step workflow to generate a complete 4-scene storyboard with AI-generated images, from script to final images.</p>
        <div className="flex gap-2 mt-2">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium border border-blue-100 dark:border-blue-800">
                <UsersIcon className="w-3 h-3" />
                Multi-Server Parallel Processing Enabled
            </div>
        </div>
      </div>

      {/* Step 1: Inputs and Storyboard Generation */}
      <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg shadow-sm">
        <h2 className="text-xl font-bold mb-1 text-neutral-900 dark:text-white">Step 1: Generate Script & Storyboard</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Provide product details and creative direction to generate a 4-scene video script.</p>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Inputs */}
          <div className="space-y-4">
            <div>
                <h3 className="text-lg font-semibold mb-2 text-neutral-900 dark:text-white">Include a Model?</h3>
                <select 
                    value={includeModel} 
                    onChange={e => {
                        const value = e.target.value as 'Yes' | 'No';
                        setIncludeModel(value);
                        if (value === 'No') {
                            setFaceImage(null);
                            setFaceImageUploadKey(Date.now());
                        }
                    }} 
                    className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-3"
                >
                    <option value="No">No, Product Only</option>
                    <option value="Yes">Yes, With a Model</option>
                </select>
            </div>
            <div>
                <h3 className="text-lg font-semibold mb-2 text-neutral-900 dark:text-white">Upload Your Assets</h3>
                <div className={`grid grid-cols-1 ${includeModel === 'Yes' ? 'sm:grid-cols-2' : ''} gap-4`}>
                    <ImageUpload key={productImageUploadKey} id="storyboard-product-upload" onImageUpload={handleProductImageUpload} onRemove={handleRemoveProductImage} title="Product Photo" description="Clear, front-facing" language={language}/>
                    {includeModel === 'Yes' && (
                        <ImageUpload key={faceImageUploadKey} id="storyboard-face-upload" onImageUpload={handleFaceImageUpload} onRemove={handleRemoveFaceImage} title="Model's Face Photo" description="Clear, front-facing" language={language}/>
                    )}
                </div>
            </div>
             <div>
                <h3 className="text-lg font-semibold mb-2 text-neutral-900 dark:text-white">Product Description & Key Selling Points</h3>
                <textarea value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder='e.g., "This is a new anti-aging serum. Key points: reduces wrinkles in 7 days, contains hyaluronic acid, suitable for sensitive skin..."' rows={4} className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-3 focus:ring-2 focus:ring-primary-500 focus:outline-none transition" />
            </div>
             <div>
                <h3 className="text-lg font-semibold mb-2 text-neutral-900 dark:text-white">Creative Direction</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium mb-1">Content Type</label><select value={selectedContentType} onChange={e => setSelectedContentType(e.target.value)} className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2 text-sm">{contentTypeOptions.map(o=><option key={o}>{o}</option>)}</select></div>
                    <div><label className="block text-sm font-medium mb-1">Output Language</label><select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2 text-sm">{languages.map(o=><option key={o}>{o}</option>)}</select></div>
                    <div><label className="block text-sm font-medium mb-1">Include Voiceover Script?</label><select value={includeVoiceover} onChange={e => setIncludeVoiceover(e.target.value as any)} className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2 text-sm"><option>Yes</option><option>No</option></select></div>
                    <div><label className="block text-sm font-medium mb-1">Include On-Screen Captions?</label><select value={includeCaptions} onChange={e => setIncludeCaptions(e.target.value as any)} className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2 text-sm"><option>Yes</option><option>No</option></select></div>
                    
                    <div>
                        <label className="block text-sm font-medium mb-1">Aspect Ratio</label>
                        <select value={imageAspectRatio} onChange={e => setImageAspectRatio(e.target.value)} className="w-full bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2 text-sm">
                            <option value="9:16">9:16 (Portrait)</option>
                            <option value="16:9">16:9 (Landscape)</option>
                            <option value="1:1">1:1 (Square)</option>
                        </select>
                    </div>
                </div>
                <div className="mt-4">
                    <CreativeDirectionPanel
                      state={creativeState}
                      setState={setCreativeState}
                      language={language}
                      showPose={false}
                      showEffect={true}
                    />
                </div>
            </div>
            <div className="flex gap-4 items-center">
                <button onClick={handleGenerate} disabled={isLoading} className="w-full bg-primary-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex-grow">
                    {isLoading ? <Spinner /> : "Generate Storyboard"}
                </button>
                 <button onClick={handleReset} disabled={isLoading} className="bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200 font-semibold py-3 px-4 rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors">
                    Reset
                </button>
            </div>
            {storyboardError && <p className="text-red-500 text-center mt-2">{storyboardError}</p>}
          </div>
          {/* Right Column: Storyboard Output */}
          <div className="bg-neutral-100 dark:bg-neutral-800/50 rounded-lg p-4 relative min-h-[300px] flex flex-col">
            <h3 className="text-lg font-semibold mb-2 flex-shrink-0 text-neutral-900 dark:text-white">Generated Storyboard</h3>
            {storyboard && (
                 <button onClick={() => downloadText(storyboard, `monoklix-storyboard-${Date.now()}.txt`)} className="absolute top-4 right-4 text-xs bg-neutral-200 dark:bg-neutral-700 py-1 px-3 rounded-full flex items-center gap-1 z-10">
                    <DownloadIcon className="w-3 h-3"/> Download Text
                </button>
            )}
            {isLoading ? <div className="flex-1 flex h-full items-center justify-center"><Spinner /></div> : (
                storyboard ? (
                    <div className="flex-1 w-full h-full overflow-y-auto custom-scrollbar space-y-3 pr-2">
                        {parsedScenes.map((scene, index) => (
                            <div key={index} className="bg-white dark:bg-neutral-800/60 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700/50">
                                <h4 className="font-semibold text-sm mb-2 text-neutral-800 dark:text-neutral-200">Scene {index + 1}</h4>
                                <textarea
                                    value={scene}
                                    onChange={(e) => handleSceneChange(index, e.target.value)}
                                    rows={6}
                                    className="w-full bg-transparent text-sm font-sans whitespace-pre-wrap custom-scrollbar resize-y focus:outline-none focus:ring-1 focus:ring-primary-500 rounded-md p-2 -m-1"
                                />
                            </div>
                        ))}
                    </div>
                )
                : <div className="flex-1 flex h-full items-center justify-center text-center text-sm text-neutral-500">Your generated storyboard will appear here.</div>
            )}
          </div>
        </div>
      </div>

      {/* Step 2: Image Generation */}
      <div className={`bg-white dark:bg-neutral-900 p-6 rounded-lg shadow-sm transition-opacity duration-500 ${step2Disabled ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex justify-between items-center mb-1">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Step 2: Generate Scene Images</h2>
            <span className="text-xs bg-neutral-200 dark:bg-neutral-700 px-2 py-1 rounded font-mono">Aspect Ratio: {imageAspectRatio}</span>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Create a unique AI-generated image for each scene from your storyboard.</p>
        <button onClick={handleGenerateAllImages} disabled={isGeneratingImages || step2Disabled} className="w-full mb-6 bg-primary-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
            {isGeneratingImages ? <Spinner/> : 'Create All 4 Images'}
        </button>
        {isGeneratingImages && <p className="text-center text-sm text-neutral-500 -mt-4 mb-4">This may take a minute...</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={`image-scene-${i}`} className="bg-neutral-100 dark:bg-neutral-800/50 p-3 rounded-lg flex flex-col gap-3">
                    <p className="font-bold text-sm">Scene {i+1}</p>
                    <div
                        onClick={() => {
                            if (generatedImages[i] && typeof generatedImages[i] === 'string') {
                                setPreviewingSceneIndex(i);
                            }
                        }}
                        className={`bg-neutral-200 dark:bg-neutral-700/50 rounded-md flex items-center justify-center relative group w-full p-0 border-0 ${generatedImages[i] && typeof generatedImages[i] === 'string' ? 'cursor-pointer' : ''}`}
                        style={{ aspectRatio: imageAspectRatio.replace(':', ' / ') }}
                        role="button"
                        tabIndex={generatedImages[i] && typeof generatedImages[i] === 'string' ? 0 : -1}
                        aria-label={`Preview scene ${i + 1}`}
                    >
                        {step2Disabled ? (
                            <div className="flex flex-col items-center justify-center text-center text-xs text-neutral-500 p-2">
                                <ImageIcon className="w-8 h-8 mb-2"/>
                                <p>Waiting for storyboard</p>
                            </div>
                        ) : imageLoadingStatus[i] ? <Spinner/> : imageGenerationErrors[i] ? (
                            <div className="text-center text-red-500 p-2">
                                <AlertTriangleIcon className="w-8 h-8 mx-auto mb-2"/>
                                <p className="text-xs">{imageGenerationErrors[i]}</p>
                            </div>
                        ) : generatedImages[i] && typeof generatedImages[i] === 'string' ? (
                            <>
                                <img src={`data:image/png;base64,${generatedImages[i]}`} alt={`Scene ${i+1}`} className="w-full h-full object-cover rounded-md"/>
                                <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => {e.stopPropagation(); onReEdit({ base64: generatedImages[i]!, mimeType: 'image/png' })}} title="Re-edit" className="p-1.5 bg-black/60 text-white rounded-full"><WandIcon className="w-4 h-4"/></button>
                                </div>
                            </>
                        ) : null}
                    </div>
                    {editingSceneIndex === i ? (
                        <div className="space-y-2 animate-zoomIn">
                            <textarea
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="e.g., make it black and white..."
                                rows={3}
                                className="w-full text-sm bg-white dark:bg-neutral-700 p-2 rounded-md resize-y focus:ring-1 focus:ring-primary-500 focus:outline-none custom-scrollbar"
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => handleEditScene(i)} 
                                    disabled={imageLoadingStatus[i] || !editPrompt.trim()} 
                                    className="w-full text-sm bg-primary-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                                >
                                    {imageLoadingStatus[i] ? <Spinner/> : 'Submit Edit'}
                                </button>
                                <button 
                                    onClick={() => setEditingSceneIndex(null)} 
                                    className="flex-shrink-0 text-sm bg-neutral-200 dark:bg-neutral-600 font-semibold py-2 px-3 rounded-md hover:bg-neutral-300 dark:hover:bg-neutral-500 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            <button 
                                onClick={() => handleRetryScene(i)} 
                                disabled={imageLoadingStatus[i] || !parsedScenes[i]} 
                                className="w-full text-sm bg-white dark:bg-neutral-700 font-semibold py-2 px-3 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {imageLoadingStatus[i] ? <Spinner/> : <><ImageIcon className="w-4 h-4"/> Create New Image</>}
                            </button>
                            <button 
                                onClick={() => { setEditingSceneIndex(i); setEditPrompt(''); }} 
                                disabled={!generatedImages[i] || typeof generatedImages[i] !== 'string' || imageLoadingStatus[i]} 
                                className="w-full text-sm bg-white dark:bg-neutral-700 font-semibold py-2 px-3 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                <WandIcon className="w-4 h-4"/> Edit This Image
                            </button>
                            <a
                                href={generatedImages[i] && typeof generatedImages[i] === 'string' ? `data:image/png;base64,${generatedImages[i]}` : undefined}
                                download={generatedImages[i] && typeof generatedImages[i] === 'string' ? `monoklix-scene-${i + 1}.png` : undefined}
                                className={`w-full text-sm bg-green-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-green-700 transition-colors flex items-center justify-center gap-2 ${!generatedImages[i] || typeof generatedImages[i] !== 'string' ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                                onClick={(e) => { if (!generatedImages[i] || typeof generatedImages[i] !== 'string') e.preventDefault(); }}
                                aria-disabled={!generatedImages[i] || typeof generatedImages[i] !== 'string'}
                                role="button"
                            >
                                <DownloadIcon className="w-4 h-4"/> Download
                            </a>
                        </div>
                    )}
                </div>
            ))}
        </div>
      </div>

      {itemToPreview && (
          <PreviewModal
              item={itemToPreview}
              onClose={() => setPreviewingSceneIndex(null)}
              getDisplayUrl={(item) => `data:image/png;base64,${item.result}`}
              onNext={handleNextPreview}
              onPrevious={handlePreviousPreview}
              hasNext={hasNextPreview}
              hasPrevious={hasPreviousPreview}
              language={language}
          />
      )}
    </div>
  );
};

export default ImageStoryboardView;

