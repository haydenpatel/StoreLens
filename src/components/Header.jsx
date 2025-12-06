import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Loader2, Clock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Header({ 
  collectionUrl, 
  setCollectionUrl, 
  onLoad, 
  loading,
  urlHistory,
  onSelectHistory 
}) {
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !loading) {
      onLoad();
    }
  };

  return (
    <header className="bg-secondary border-b border-border sticky top-0 z-10">
    {/* <header className="bg-secondary sticky top-0 z-10"> */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-26 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-lg flex items-top justify-center">
              <img src="/StoreLens-icon.svg"></img>
              <Package className="w-5 h-5 text-background" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">StoreLens</h1>
          </div>

          <div className="flex-1 flex items-center gap-2 max-w-2xl">
            <Input
              type="text"
              placeholder="Paste Shopify collection URL (e.g., https://store.myshopify.com/collections/all)"
              value={collectionUrl}
              onChange={(e) => setCollectionUrl(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              className="flex-1"
            />
            
            {urlHistory.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" disabled={loading}>
                    <Clock className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Recent Collections</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {urlHistory.map((url, index) => (
                    <DropdownMenuItem 
                      key={index}
                      onClick={() => onSelectHistory(url)}
                      className="cursor-pointer"
                    >
                      <div className="truncate text-sm">{url}</div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button 
              onClick={onLoad} 
              disabled={loading || !collectionUrl.trim()}
              // variant="default"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load Collection"
              )}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}