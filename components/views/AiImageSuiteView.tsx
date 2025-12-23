
import React, { useState, useEffect } from 'react';
import ImageEnhancerView from './ImageEnhancerView';
import ImageGenerationView from './ImageGenerationView';
import BackgroundRemoverView from './BackgroundRemoverView';
import ProductPhotoView from './ProductPhotoView';
import TiktokAffiliateView from './TiktokAffiliateView';
import ImageStoryboardView from './ImageStoryboardView';
import Tabs, { type Tab } from '../common/Tabs';
import { type Language, type User } from '../../types';

type TabId = 'generation' | 'enhancer' | 'remover' | 'product' | 'model' | 'storyboard';

interface VideoGenPreset {
  prompt: string;
  image: { base64: string; mimeType: string; };
}

interface ImageEditPreset {
  base64: string;
  mimeType: string;
}

interface AiImageSuiteViewProps {
  onCreateVideo: (preset: VideoGenPreset) => void;
  onReEdit: (preset: ImageEditPreset) => void;
  imageToReEdit: ImageEditPreset | null;
  clearReEdit: () => void;
  presetPrompt: string | null;
  clearPresetPrompt: () => void;
  currentUser: User;
  onUserUpdate: (user: User) => void;
  language: Language;
}

const AiImageSuiteView: React.FC<AiImageSuiteViewProps> = ({ onCreateVideo, onReEdit, imageToReEdit, clearReEdit, presetPrompt, clearPresetPrompt, currentUser, onUserUpdate, language }) => {
    // Check if user wants to open storyboard tab from dashboard
    const getInitialTab = (): TabId => {
        const savedTab = sessionStorage.getItem('aiImageSuiteActiveTab');
        if (savedTab === 'storyboard') {
            sessionStorage.removeItem('aiImageSuiteActiveTab');
            return 'storyboard';
        }
        return 'generation';
    };
    const [activeTab, setActiveTab] = useState<TabId>(getInitialTab());

    const tabs: Tab<TabId>[] = [
        { id: 'generation', label: "Image Generation" },
        { id: 'storyboard', label: "Image Storyboard" },
        { id: 'product', label: "Product Photos" },
        { id: 'model', label: "Model Photos" },
        { id: 'enhancer', label: "Enhancer" },
        { id: 'remover', label: "Background Remover" },
    ];

    useEffect(() => {
        if (imageToReEdit) {
            setActiveTab('generation');
        }
    }, [imageToReEdit]);

    useEffect(() => {
        if (presetPrompt) {
            setActiveTab('generation');
        }
    }, [presetPrompt]);

    const renderActiveTabContent = () => {
        const commonProps = { onReEdit, onCreateVideo, currentUser, onUserUpdate, language };
        switch (activeTab) {
            case 'generation':
                return <ImageGenerationView 
                          {...commonProps} 
                          imageToReEdit={imageToReEdit} 
                          clearReEdit={clearReEdit}
                          presetPrompt={presetPrompt}
                          clearPresetPrompt={clearPresetPrompt} 
                        />;
            case 'storyboard':
                return <ImageStoryboardView 
                          onReEdit={onReEdit}
                          currentUser={currentUser}
                          onUserUpdate={onUserUpdate}
                          language={language}
                        />;
            case 'enhancer':
                return <ImageEnhancerView {...commonProps} />;
            case 'remover':
                return <BackgroundRemoverView {...commonProps} />;
            case 'product':
                return <ProductPhotoView {...commonProps} />;
            case 'model':
                return <TiktokAffiliateView {...commonProps} />;
            default:
                return <ImageGenerationView 
                          {...commonProps} 
                          imageToReEdit={imageToReEdit} 
                          clearReEdit={clearReEdit}
                          presetPrompt={presetPrompt}
                          clearPresetPrompt={clearPresetPrompt} 
                        />;
        }
    };

    // 'storyboard' is the only view that is NOT a fixed-height layout and needs external scrolling.
    const isScrollableTab = activeTab === 'storyboard';

    return (
        <div className="h-auto lg:h-full flex flex-col">
            <div className="flex-shrink-0 mb-6 flex justify-center">
                <Tabs 
                    tabs={tabs}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                />
            </div>
            <div className={`flex-1 min-h-0 ${isScrollableTab ? 'overflow-y-auto' : ''}`}>
                {renderActiveTabContent()}
            </div>
        </div>
    );
};

export default AiImageSuiteView;
