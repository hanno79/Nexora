/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Kompakte 404-Seite fuer nicht registrierte Frontend-Routen.
*/

// ÄNDERUNG 08.03.2026: Header, Aenderungsdokumentation und kleine Sprachvereinheitlichung fuer Phase-0-Paket-2 ergaenzt.

import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Seite nicht gefunden</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Wurde die Seite im Router noch nicht registriert?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
