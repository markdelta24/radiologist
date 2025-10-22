'use client';

import { useState } from 'react';
import AnalysisResults from '@/components/AnalysisResults';
import SinglePageUpload from '@/components/SinglePageUpload';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ProblemInfo { problem: string }

type Step = 'upload' | 'results';

export default function Home() {
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalysisComplete = (results: any) => {
    setAnalysisResults(results);
    setIsAnalyzing(false);
    setCurrentStep('results');
  };

  const handleAnalysisStart = () => {
    setIsAnalyzing(true);
    setAnalysisResults(null);
  };

  const handleStartOver = () => {
    setCurrentStep('upload');
    setAnalysisResults(null);
    setIsAnalyzing(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-6 md:p-8 font-['Helvetica',_'Arial',_sans-serif]">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">
            Scan Analyzer
          </h1>
          <p className="text-base sm:text-lg text-gray-700">
            AI-powered medical image analysis
          </p>
        </div>

        {/* Single Page Content */}
        {currentStep === 'upload' && (
          <SinglePageUpload
            onAnalysisStart={handleAnalysisStart}
            onAnalysisComplete={handleAnalysisComplete}
            isAnalyzing={isAnalyzing}
          />
        )}

        {currentStep === 'results' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Analysis Results */}
            <Card className="p-4 sm:p-6">
              <AnalysisResults
                results={analysisResults}
                isAnalyzing={isAnalyzing}
              />
            </Card>

            {/* Actions */}
            <div className="text-center px-4">
              <Button
                onClick={handleStartOver}
                size="lg"
                className="w-full sm:w-auto text-sm sm:text-base"
              >
                Start New Analysis
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
