'use client';

import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

interface AnalysisResultsProps {
  results: OverallAnalysis | null;
  isAnalyzing: boolean;
}

interface FrameAnalysis {
  frameNumber: number;
  analysis: string;
  confidence: number;
  findings: string[];
}

interface OverallAnalysis {
  summary: string;
  recommendations: string[];
  urgency: 'low' | 'medium' | 'high';
  frameAnalyses: FrameAnalysis[];
}

function formatSummaryAsMarkdown(summary: string): string {
  // Split into lines and process medical report structure
  const lines = summary.split('\n');
  const formatted: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Major section headings (all caps at start of line)
    if (/^([A-Z\s&]+)(?=\s[A-Z][a-z]|$)/.test(line)) {
      const match = line.match(/^([A-Z\s&]+)(?=\s|$)/);
      if (match) {
        const heading = match[1].trim();
        const rest = line.substring(match[0].length).trim();

        // Only treat as heading if it's a known section or all caps
        if (heading.length > 2 && (
          heading === 'FINDINGS' ||
          heading === 'IMPRESSION' ||
          heading === 'RECOMMENDATION' ||
          heading === 'CLINICAL HISTORY' ||
          heading.split(/\s+/).every(word => word === word.toUpperCase() && word.length > 1)
        )) {
          formatted.push(`\n## ${heading}\n`);
          if (rest) {
            formatted.push(rest);
          }
          continue;
        }
      }
    }

    // Numbered sections (1., 2., 3., etc)
    if (/^\d+\.\s*$/.test(line)) {
      formatted.push(`\n**${line}**\n`);
      continue;
    }

    // Bullet points or asterisk lists
    if (/^[*•-]\s/.test(line)) {
      formatted.push(`\n${line}\n`);
      continue;
    }

    // Bold labels (word followed by colon)
    line = line.replace(/^([A-Za-z\s]+):/g, '**$1:**');

    // Add the line
    formatted.push(line + ' ');
  }

  return formatted.join('').trim();
}

export default function AnalysisResults({ results, isAnalyzing }: AnalysisResultsProps) {
  if (isAnalyzing) {
    return (
      <div className="text-center py-6 sm:py-8 px-4">
        <div className="flex flex-col items-center gap-3 sm:gap-4">
          <Spinner className="w-12 h-12 sm:w-16 sm:h-16" />
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">
              Analyzing CT Frames with AI...
            </h3>
            <p className="text-sm sm:text-base text-gray-600">
              Please wait while we analyze each frame with Gemini 2.5 Pro
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  const analysis: OverallAnalysis = results;

  return (
    <div className="max-w-5xl mx-auto space-y-6 px-4 sm:px-6 lg:px-8">
      {/* Main Report Card */}
      <Card className="shadow-xl border-0 overflow-hidden">
        {/* Report Header */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-blue-600 px-6 sm:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 bg-blue-600 rounded-full"></div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
              RADIOLOGY REPORT
            </h2>
          </div>
        </div>

        {/* Report Content */}
        <CardContent className="px-6 sm:px-8 py-6 sm:py-8 bg-white">
          <div className="prose prose-sm sm:prose-base lg:prose-lg max-w-none">
            <ReactMarkdown
              components={{
                // Main section headers (PATIENT INFORMATION, EXAM TYPE, etc.)
                h1: (props) => (
                  <div className="mb-6 sm:mb-8 mt-8 sm:mt-10 first:mt-0">
                    <h1
                      className="text-lg sm:text-xl font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 rounded-md shadow-md uppercase tracking-wide mb-4"
                      {...props}
                    />
                  </div>
                ),
                // Section headings (FINDINGS, IMPRESSION, RECOMMENDATION, etc.)
                h2: (props) => (
                  <div className="mb-4 sm:mb-6 mt-6 sm:mt-8">
                    <h2
                      className="text-base sm:text-lg font-bold text-gray-900 bg-gray-100 px-4 py-2.5 rounded-md border-l-4 border-blue-600 uppercase tracking-wide"
                      {...props}
                    />
                  </div>
                ),
                // Subsection headings
                h3: (props) => (
                  <h3
                    className="text-sm sm:text-base font-semibold text-gray-800 mt-4 sm:mt-5 mb-2 sm:mb-3 border-b border-gray-300 pb-1"
                    {...props}
                  />
                ),
                // Paragraphs
                p: (props) => (
                  <p
                    className="mb-3 sm:mb-4 text-sm sm:text-base leading-7 sm:leading-8 text-gray-700 font-['Georgia',_'Times_New_Roman',_serif]"
                    {...props}
                  />
                ),
                // Bold text (labels)
                strong: (props) => (
                  <strong
                    className="font-bold text-gray-900 bg-yellow-50 px-1 py-0.5 rounded"
                    {...props}
                  />
                ),
                // Unordered lists
                ul: (props) => (
                  <ul
                    className="list-none ml-0 mb-4 sm:mb-6 space-y-2 sm:space-y-3"
                    {...props}
                  />
                ),
                // Ordered lists
                ol: (props) => (
                  <ol
                    className="list-decimal list-outside ml-6 sm:ml-8 mb-4 sm:mb-6 space-y-2 sm:space-y-3"
                    {...props}
                  />
                ),
                // List items
                li: (props) => (
                  <li
                    className="text-gray-700 text-sm sm:text-base leading-7 sm:leading-8 pl-4 relative before:content-['▸'] before:absolute before:left-0 before:text-blue-600 before:font-bold"
                    {...props}
                  />
                ),
                // Code/monospace text
                code: (props) => (
                  <code
                    className="bg-gray-100 border border-gray-300 px-2 py-1 rounded text-xs sm:text-sm font-mono text-gray-800"
                    {...props}
                  />
                ),
              }}
            >
              {formatSummaryAsMarkdown(analysis.summary)}
            </ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}