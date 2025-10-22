'use client';

import { useState } from 'react';

interface ProblemInfo {
  problem: string;
}

interface PatientInfoFormProps {
  onSubmit: (patientInfo: ProblemInfo) => void;
  onBack?: () => void;
  isSubmitting?: boolean;
}

export default function PatientInfoForm({ onSubmit, onBack, isSubmitting }: PatientInfoFormProps) {
  const [patientInfo, setPatientInfo] = useState<ProblemInfo>({
    problem: ''
  });

  const [error, setError] = useState<string>('');

  const handleInputChange = (value: string) => {
    setPatientInfo({ problem: value });
    if (error) setError('');
  };

  const validateForm = (): boolean => {
    if (!patientInfo.problem.trim()) {
      setError('Please describe the problem you want the doctor to analyze.');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onSubmit(patientInfo);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Tell us the problem</h2>
          <p className="text-gray-600">
            In one message, describe the patient complaint or clinical question for the CT scan.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Problem / Clinical Question *
            </label>
            <textarea
              value={patientInfo.problem}
              onChange={(e) => handleInputChange(e.target.value)}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-28 ${
                error ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="e.g., Persistent headaches and dizziness for 3 months; rule out mass or vascular issue."
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
          </div>

          {/* Buttons */}
          <div className="flex justify-between pt-4">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting}
              >
                Back
              </button>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
              } ${!onBack ? 'ml-auto' : ''}`}
            >
            {isSubmitting ? 'Processing...' : 'Continue to Upload'}
            </button>
          </div>
        </form>

        {/* Privacy Notice */}
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex">
            <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-yellow-800">Privacy & Data Security</h4>
              <p className="text-sm text-yellow-700 mt-1">
                Patient information is used only for AI analysis and is not stored permanently.
                This tool is for educational purposes and should not replace professional medical consultation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}