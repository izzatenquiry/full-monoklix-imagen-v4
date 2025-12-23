
import React, { useState, useEffect } from 'react';
import { getContent } from '../../services/contentService';
import { type TutorialContent, type User, type Language, type View } from '../../types';
import { ImageIcon, WandIcon, FileTextIcon, ChevronRightIcon } from '../Icons';

interface DashboardViewProps {
    currentUser: User;
    language: Language;
    navigateTo: (view: View) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({ currentUser, navigateTo }) => {
  const [content, setContent] = useState<TutorialContent | null>(null);

  useEffect(() => {
    const fetchPageData = async () => {
        const contentData = await getContent();
        setContent(contentData);
    };
    fetchPageData();
  }, []);

  const QuickActionCard = ({ title, desc, icon: Icon, color, onClick, delay }: any) => (
      <button 
        onClick={onClick}
        className={`holo-card p-6 flex flex-col items-start justify-between h-40 group hover:border-${color}-500/50 transition-all duration-500 animate-zoomIn`}
        style={{ animationDelay: `${delay}ms` }}
      >
          {/* Ambient Glow */}
          <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full bg-${color}-500 opacity-20 blur-[50px] group-hover:opacity-40 transition-opacity duration-500`}></div>
          
          <div className={`relative z-10 p-3 rounded-2xl bg-neutral-100 dark:bg-white/5 border border-neutral-300 dark:border-white/10 text-${color}-600 dark:text-${color}-400 group-hover:text-white group-hover:bg-${color}-500 group-hover:border-${color}-400 transition-all duration-300`}>
              <Icon className="w-6 h-6" />
          </div>
          
          <div className="relative z-10 text-left w-full">
              <div className="flex justify-between items-center w-full">
                  <h3 className="font-bold text-lg text-neutral-900 dark:text-white group-hover:text-glow transition-all">{title}</h3>
                  <ChevronRightIcon className="w-4 h-4 text-neutral-600 dark:text-white/30 group-hover:text-neutral-900 dark:group-hover:text-white group-hover:translate-x-1 transition-all" />
              </div>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 font-medium">{desc}</p>
          </div>
      </button>
  );

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      
      {/* Header Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end mb-4 animate-zoomIn">
        {/* Hello Message */}
        <div className="lg:col-span-12">
            <div className="flex items-center gap-3 mb-2">
                <div className="h-px w-8 bg-brand-start"></div>
                <span className="text-xs font-mono text-brand-start tracking-widest uppercase">System Online</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black text-neutral-900 dark:text-white tracking-tight leading-none">
                HELLO, <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-start to-brand-end">{currentUser.fullName?.split(' ')[0] || currentUser.username}</span>
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400 mt-2 text-lg font-light">Welcome to the future of content creation.</p>
        </div>
      </div>

      {/* Main Content Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        
        {/* Left Panel: Welcome Video */}
        {content?.mainVideoUrl && (
            <div className="w-full animate-zoomIn h-full" style={{ animationDelay: '50ms' }}>
                <div className="bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-2xl p-1 rounded-3xl overflow-hidden shadow-2xl border border-neutral-200 dark:border-white/10 relative group h-full">
                    <div className="relative aspect-video w-full bg-black rounded-[1.2rem] overflow-hidden">
                        <iframe 
                            src={content.mainVideoUrl} 
                            title="Get Started"
                            className="w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                            allowFullScreen
                        ></iframe>
                    </div>
                </div>
            </div>
        )}

        {/* Right Panel: Action Modules (2x2 Grid) */}
        <div className="grid grid-cols-2 gap-4 md:gap-6 w-full">
            <QuickActionCard 
                title="Image Gen" 
                desc="Flux / Imagen Engine" 
                icon={ImageIcon} 
                color="purple" 
                onClick={() => navigateTo('ai-image-suite')}
                delay={100}
            />
            <QuickActionCard 
                title="Storyboard" 
                desc="AI Storyboard Generator" 
                icon={ImageIcon} 
                color="blue" 
                onClick={() => {
                    sessionStorage.setItem('aiImageSuiteActiveTab', 'storyboard');
                    navigateTo('ai-image-suite');
                }}
                delay={200}
            />
            <QuickActionCard 
                title="Copywriter" 
                desc="Neuro-Language" 
                icon={FileTextIcon} 
                color="green" 
                onClick={() => navigateTo('ai-text-suite')}
                delay={300}
            />
            <QuickActionCard 
                title="Enhancer" 
                desc="Upscale Logic" 
                icon={WandIcon} 
                color="pink" 
                onClick={() => navigateTo('ai-image-suite')}
                delay={400}
            />
        </div>

      </div>
    </div>
  );
};

export default DashboardView;
